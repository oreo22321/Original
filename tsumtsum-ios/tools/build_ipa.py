#!/usr/bin/env python3
"""Build a sideloadable .ipa: decrypted game ipa + TsumMod.dylib (+ optional verified byte patches).

Usage:
  python3 -I build_ipa.py --ipa Game-decrypted.ipa --dylib TsumMod.dylib --out TsumTsum-Mod.ipa [--patches patches.json]

The output is unsigned for distribution purposes; eSign / KSign re-sign it on install.
Nothing is written unless every check passes; the input ipa is never modified.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import macho  # noqa: E402
from ipa_common import IpaError, app_info  # noqa: E402

DYLIB_NAME = "TsumMod.dylib"
LOAD_PATH = "@executable_path/Frameworks/" + DYLIB_NAME


class BuildError(Exception):
    pass


def apply_patches(files: dict[str, bytearray], app_dir: str, spec: dict) -> list[str]:
    log = []
    build = spec.get("build", {})
    for p in spec.get("patches", []):
        image = app_dir + p["image"]
        if image not in files:
            raise BuildError(f"patch image not in ipa: {p['image']}")
        data = files[image]
        slices = [s for s in macho.parse(bytes(data)) if s.arch == p.get("arch", "arm64")]
        if not slices:
            raise BuildError(f"{p['image']}: no {p.get('arch', 'arm64')} slice")
        sl = slices[0]
        want_uuid = p.get("uuid") or build.get("uuid")
        if want_uuid and sl.uuid != want_uuid.upper():
            raise BuildError(f"{p['image']}: UUID {sl.uuid} != patch UUID {want_uuid}")
        expect = bytes.fromhex(p["expect"])
        repl = bytes.fromhex(p["replace"])
        if len(expect) != len(repl) or not expect:
            raise BuildError(f"patch {p.get('note', '')}: expect/replace must be same non-zero length")
        off = sl.vmaddr_to_fileoff(int(p["vmaddr"], 16))
        cur = bytes(data[off:off + len(expect)])
        if cur == repl:
            log.append(f"already applied: {p.get('note', p['vmaddr'])}")
            continue
        if cur != expect:
            raise BuildError(f"patch {p.get('note', p['vmaddr'])}: bytes at {p['vmaddr']} are {cur.hex()}, expected {expect.hex()}")
        data[off:off + len(repl)] = repl
        log.append(f"patched {p['image']} {p['vmaddr']} ({len(repl)} bytes): {p.get('note', '')}")
    return log


def build(ipa: str, dylib: str, out: str, patches: str | None, weak: bool) -> list[str]:
    if os.path.abspath(ipa) == os.path.abspath(out):
        raise BuildError("--out must differ from --ipa")
    with open(dylib, "rb") as f:
        dylib_data = f.read()
    dl = macho.parse(dylib_data)
    if not any(s.arch == "arm64" for s in dl):
        raise BuildError("dylib has no arm64 slice")

    zin = zipfile.ZipFile(ipa)
    info = app_info(zin)
    files: dict[str, bytearray] = {}
    for n in [info.executable]:
        files[n] = bytearray(zin.read(n))

    spec = None
    if patches:
        with open(patches, encoding="utf-8") as f:
            spec = json.load(f)
        for p in spec.get("patches", []):
            n = info.app_dir + p["image"]
            if n not in files:
                files[n] = bytearray(zin.read(n))

    log: list[str] = []
    for name, data in files.items():
        for s in macho.parse(bytes(data)):
            if s.cryptid:
                raise BuildError(f"{name} [{s.arch}] is still FairPlay-encrypted (cryptid 1); use a decrypted ipa")
    if spec:
        log += apply_patches(files, info.app_dir, spec)

    exe = files[info.executable]
    for s in macho.parse(bytes(exe)):
        if s.arch != "arm64":
            continue
        if macho.insert_load_dylib(exe, s, LOAD_PATH, weak):
            log.append(f"added {'LC_LOAD_WEAK_DYLIB' if weak else 'LC_LOAD_DYLIB'} {LOAD_PATH} to {info.executable} [arm64]")
        else:
            log.append(f"{LOAD_PATH} already linked")
    new_slices = macho.parse(bytes(exe))
    if not any(LOAD_PATH in s.dylibs for s in new_slices if s.arch == "arm64"):
        raise BuildError("load command not present after insertion")

    dylib_path = info.app_dir + "Frameworks/" + DYLIB_NAME
    tmp = out + ".partial"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            if item.filename == dylib_path:
                continue
            payload = bytes(files[item.filename]) if item.filename in files else zin.read(item.filename)
            zout.writestr(item, payload, compress_type=item.compress_type)
        zi = zipfile.ZipInfo(dylib_path, date_time=(2020, 1, 1, 0, 0, 0))
        zi.external_attr = (0o100755 << 16)
        zi.compress_type = zipfile.ZIP_DEFLATED
        zout.writestr(zi, dylib_data)
    os.replace(tmp, out)
    log.append(f"wrote {out}")
    return log


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ipa", required=True, help="decrypted game ipa")
    ap.add_argument("--dylib", required=True, help="TsumMod.dylib from the CI build")
    ap.add_argument("--out", required=True)
    ap.add_argument("--patches", help="patches.json with verified byte patches")
    ap.add_argument("--weak", action="store_true", help="use LC_LOAD_WEAK_DYLIB (app still launches if the dylib is missing)")
    a = ap.parse_args()
    try:
        for line in build(a.ipa, a.dylib, a.out, a.patches, a.weak):
            print(line)
    except (BuildError, IpaError, macho.MachOError, zipfile.BadZipFile, KeyError, ValueError, OSError) as e:
        print(f"error: {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
