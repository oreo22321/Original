#!/usr/bin/env python3
"""Inspect a decrypted .ipa: identity, encryption state, architecture, UUID and engine evidence.

Usage: python3 -I ipa_recon.py Game.ipa
Prints the values that go into GameConfig.hpp kBuild and which image to load into IDA/Ghidra.
"""
from __future__ import annotations

import argparse
import os
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import macho  # noqa: E402
from ipa_common import IpaError, app_info  # noqa: E402

ENGINE_FILE_MARKERS = [
    ("Unity", "Frameworks/UnityFramework.framework/UnityFramework"),
    ("Unity (IL2CPP metadata)", "Data/Managed/Metadata/global-metadata.dat"),
    ("Flutter", "Frameworks/Flutter.framework/Flutter"),
    ("Unreal", "cookeddata/"),
]
ENGINE_STRING_MARKERS = [
    ("Cocos2d-x", b"cocos2d-x"),
    ("Cocos Creator", b"cocos2d-x-3"),
    ("Unity", b"il2cpp_domain_get"),
    ("Unity (Mono)", b"mono_runtime_invoke"),
    ("Unreal", b"UnrealEngine"),
    ("Godot", b"Godot Engine"),
    ("Defold", b"defold"),
]


def describe_binary(name: str, data: bytes) -> list[str]:
    out = []
    try:
        slices = macho.parse(data)
    except macho.MachOError as e:
        return [f"  {name}: not parsed ({e})"]
    for s in slices:
        enc = "no LC_ENCRYPTION_INFO" if s.cryptid is None else ("ENCRYPTED (cryptid 1)" if s.cryptid else "decrypted (cryptid 0)")
        out.append(f"  {name} [{s.arch}] uuid={s.uuid} {enc} size=0x{s.size:x}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ipa")
    args = ap.parse_args()
    try:
        z = zipfile.ZipFile(args.ipa)
        info = app_info(z)
    except (zipfile.BadZipFile, IpaError) as e:
        print(f"error: {e}")
        return 2

    names = z.namelist()
    rel = [n[len(info.app_dir):] for n in names if n.startswith(info.app_dir)]
    print(f"bundle id : {info.bundle_id}")
    print(f"version   : {info.version} (build {info.build})")
    print(f"executable: {info.executable}")

    print("\nbinaries:")
    exe_data = z.read(info.executable)
    for line in describe_binary(os.path.basename(info.executable), exe_data):
        print(line)
    frameworks = sorted({r.split("/")[1] for r in rel if r.startswith("Frameworks/") and r.count("/") >= 1 and r.split("/")[1]})
    fw_bins = {}
    for fw in frameworks:
        if fw.endswith(".framework"):
            path = f"{info.app_dir}Frameworks/{fw}/{fw[:-len('.framework')]}"
        elif fw.endswith(".dylib"):
            path = f"{info.app_dir}Frameworks/{fw}"
        else:
            continue
        if path in names:
            fw_bins[fw] = z.read(path)
            for line in describe_binary(fw, fw_bins[fw]):
                print(line)

    print("\nengine evidence:")
    found = False
    for engine, marker in ENGINE_FILE_MARKERS:
        if any(r.startswith(marker) for r in rel):
            print(f"  {engine}: file {marker}")
            found = True
    for engine, needle in ENGINE_STRING_MARKERS:
        hits = [n for n, d in [(os.path.basename(info.executable), exe_data), *fw_bins.items()] if needle in d]
        if hits:
            print(f"  {engine}: string {needle.decode()!r} in {', '.join(hits)}")
            found = True
    if not found:
        print("  none of the known markers; treat as custom engine")

    print("\nnext:")
    print("  - every binary you will patch or analyze must say 'decrypted (cryptid 0)'")
    print("  - copy bundle id, version, the code image name and its UUID into GameConfig.hpp kBuild")
    return 0


if __name__ == "__main__":
    sys.exit(main())
