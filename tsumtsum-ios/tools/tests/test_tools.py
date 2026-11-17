"""python3 -m unittest discover -s tsumtsum-ios/tools/tests"""
from __future__ import annotations

import json
import os
import plistlib
import struct
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import build_ipa  # noqa: E402
import macho  # noqa: E402

TEXT_VM = 0x100000000
CODE_OFF = 0x4000
CODE = bytes.fromhex("1f2003d5c0035fd6")  # nop; ret


def make_macho(cryptid: int = 0, pad_to: int = CODE_OFF, filetype: int = 2) -> bytes:
    cmds = b""
    cmds += struct.pack("<II16sQQQQiiII", macho.LC_SEGMENT_64, 72, b"__PAGEZERO", 0, TEXT_VM, 0, 0, 0, 0, 0, 0)
    sect = struct.pack("<16s16sQQIIIIIIII", b"__text", b"__TEXT", TEXT_VM + CODE_OFF, len(CODE), CODE_OFF, 2, 0, 0,
                       0x80000400, 0, 0, 0)
    cmds += struct.pack("<II16sQQQQiiII", macho.LC_SEGMENT_64, 72 + 80, b"__TEXT", TEXT_VM, 0x8000, 0, 0x8000, 5, 5, 1, 0) + sect
    cmds += struct.pack("<II", macho.LC_UUID, 24) + bytes(range(16))
    cmds += struct.pack("<IIIIII", macho.LC_ENCRYPTION_INFO_64, 24, CODE_OFF, 0x4000, cryptid, 0)
    hdr = struct.pack("<IiiIIIII", macho.MH_MAGIC_64, macho.CPU_TYPE_ARM64, 0, filetype, 4, len(cmds), 0, 0)
    body = (hdr + cmds).ljust(pad_to, b"\0") + CODE
    return body.ljust(0x8000, b"\0")


def make_ipa(path: str, exe: bytes) -> None:
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("Payload/Game.app/Info.plist", plistlib.dumps({
            "CFBundleExecutable": "Game", "CFBundleIdentifier": "com.example.game",
            "CFBundleShortVersionString": "1.0", "CFBundleVersion": "1"}))
        zi = zipfile.ZipInfo("Payload/Game.app/Game")
        zi.external_attr = 0o100755 << 16
        z.writestr(zi, exe)
        z.writestr("Payload/Game.app/assets/a.txt", b"x")


class MachOTests(unittest.TestCase):
    def test_parse(self):
        s = macho.parse(make_macho())[0]
        self.assertEqual(s.arch, "arm64")
        self.assertEqual(s.uuid, "00010203-0405-0607-0809-0A0B0C0D0E0F")
        self.assertEqual(s.cryptid, 0)
        self.assertEqual(s.vmaddr_to_fileoff(TEXT_VM + CODE_OFF), CODE_OFF)
        with self.assertRaises(macho.MachOError):
            s.vmaddr_to_fileoff(0x10)

    def test_insert(self):
        data = bytearray(make_macho())
        s = macho.parse(bytes(data))[0]
        self.assertTrue(macho.insert_load_dylib(data, s, "@executable_path/Frameworks/X.dylib"))
        s2 = macho.parse(bytes(data))[0]
        self.assertEqual(s2.ncmds, s.ncmds + 1)
        self.assertIn("@executable_path/Frameworks/X.dylib", s2.dylibs)
        self.assertEqual(bytes(data[CODE_OFF:CODE_OFF + len(CODE)]), CODE)  # content untouched
        self.assertFalse(macho.insert_load_dylib(data, s2, "@executable_path/Frameworks/X.dylib"))

    def test_insert_no_room(self):
        hdr_end = 32 + macho.parse(make_macho())[0].sizeofcmds
        data = bytearray(make_macho(pad_to=CODE_OFF))
        s = macho.parse(bytes(data))[0]
        data[hdr_end + 8] = 0xAA  # non-zero byte right after the commands
        with self.assertRaises(macho.MachOError):
            macho.insert_load_dylib(data, s, "@executable_path/Frameworks/LongName.dylib")

    def test_fat(self):
        thin = make_macho()
        fat = struct.pack(">II", macho.FAT_MAGIC, 1) + struct.pack(">iiIII", macho.CPU_TYPE_ARM64, 0, 0x4000, len(thin), 14)
        fat = fat.ljust(0x4000, b"\0") + thin
        s = macho.parse(fat)[0]
        self.assertEqual(s.offset, 0x4000)
        self.assertEqual(s.vmaddr_to_fileoff(TEXT_VM + CODE_OFF), 0x4000 + CODE_OFF)


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.dylib = os.path.join(self.d, "TsumMod.dylib")
        with open(self.dylib, "wb") as f:
            f.write(make_macho(filetype=6))

    def p(self, n):
        return os.path.join(self.d, n)

    def test_build_and_patch(self):
        make_ipa(self.p("in.ipa"), make_macho())
        with open(self.p("patches.json"), "w") as f:
            json.dump({"build": {"uuid": "00010203-0405-0607-0809-0A0B0C0D0E0F"}, "patches": [
                {"image": "Game", "vmaddr": hex(TEXT_VM + CODE_OFF), "expect": "1f2003d5", "replace": "20008052", "note": "t"}]}, f)
        build_ipa.build(self.p("in.ipa"), self.dylib, self.p("out.ipa"), self.p("patches.json"), False)
        with zipfile.ZipFile(self.p("out.ipa")) as z:
            exe = z.read("Payload/Game.app/Game")
            self.assertIn("Payload/Game.app/Frameworks/TsumMod.dylib", z.namelist())
            self.assertIn("Payload/Game.app/assets/a.txt", z.namelist())
            self.assertEqual((z.getinfo("Payload/Game.app/Game").external_attr >> 16) & 0o777, 0o755)
        self.assertEqual(exe[CODE_OFF:CODE_OFF + 4], bytes.fromhex("20008052"))
        self.assertIn(build_ipa.LOAD_PATH, macho.parse(exe)[0].dylibs)

    def test_patch_mismatch_aborts(self):
        make_ipa(self.p("in.ipa"), make_macho())
        with open(self.p("patches.json"), "w") as f:
            json.dump({"patches": [{"image": "Game", "vmaddr": hex(TEXT_VM + CODE_OFF), "expect": "deadbeef", "replace": "00000000"}]}, f)
        with self.assertRaises(build_ipa.BuildError):
            build_ipa.build(self.p("in.ipa"), self.dylib, self.p("out.ipa"), self.p("patches.json"), False)
        self.assertFalse(os.path.exists(self.p("out.ipa")))

    def test_encrypted_refused(self):
        make_ipa(self.p("in.ipa"), make_macho(cryptid=1))
        with self.assertRaises(build_ipa.BuildError):
            build_ipa.build(self.p("in.ipa"), self.dylib, self.p("out.ipa"), None, False)

    def test_uuid_mismatch(self):
        make_ipa(self.p("in.ipa"), make_macho())
        with open(self.p("patches.json"), "w") as f:
            json.dump({"build": {"uuid": "FFFFFFFF-0405-0607-0809-0A0B0C0D0E0F"}, "patches": [
                {"image": "Game", "vmaddr": hex(TEXT_VM + CODE_OFF), "expect": "1f2003d5", "replace": "20008052"}]}, f)
        with self.assertRaises(build_ipa.BuildError):
            build_ipa.build(self.p("in.ipa"), self.dylib, self.p("out.ipa"), self.p("patches.json"), False)


if __name__ == "__main__":
    unittest.main()
