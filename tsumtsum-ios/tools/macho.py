"""Minimal Mach-O reader/editor for 64-bit iOS binaries (thin or fat). Standard library only."""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

MH_MAGIC_64 = 0xFEEDFACF
FAT_MAGIC = 0xCAFEBABE
FAT_MAGIC_64 = 0xCAFEBABF
CPU_TYPE_ARM64 = 0x0100000C

LC_SEGMENT_64 = 0x19
LC_UUID = 0x1B
LC_ENCRYPTION_INFO_64 = 0x2C
LC_LOAD_DYLIB = 0x0C
LC_LOAD_WEAK_DYLIB = 0x80000018
LC_ID_DYLIB = 0x0D
LC_REEXPORT_DYLIB = 0x8000001F

HEADER_SIZE = 32
S_ZEROFILL_TYPES = {0x1, 0xC, 0x12}  # S_ZEROFILL, S_GB_ZEROFILL, S_THREAD_LOCAL_ZEROFILL


class MachOError(Exception):
    pass


@dataclass
class Section:
    segname: str
    sectname: str
    addr: int
    size: int
    offset: int
    flags: int


@dataclass
class Segment:
    name: str
    vmaddr: int
    vmsize: int
    fileoff: int
    filesize: int
    sections: list[Section] = field(default_factory=list)


@dataclass
class Slice:
    offset: int          # file offset of this slice inside the whole file
    size: int
    cputype: int
    ncmds: int
    sizeofcmds: int
    segments: list[Segment]
    uuid: str | None
    cryptid: int | None  # None = no LC_ENCRYPTION_INFO_64
    dylibs: list[str]

    @property
    def arch(self) -> str:
        return "arm64" if self.cputype == CPU_TYPE_ARM64 else f"cpu 0x{self.cputype:x}"

    def vmaddr_to_fileoff(self, vmaddr: int) -> int:
        """Unslid VM address (as shown by IDA/Ghidra at the default base) -> offset in the whole file."""
        for seg in self.segments:
            if seg.vmaddr <= vmaddr < seg.vmaddr + seg.filesize:
                return self.offset + seg.fileoff + (vmaddr - seg.vmaddr)
        raise MachOError(f"vmaddr 0x{vmaddr:x} is not file-backed in any segment")

    def free_header_space(self, data: bytes) -> int:
        """Bytes available after the load commands before the first file-backed content."""
        limit = self.size
        for seg in self.segments:
            if seg.filesize and seg.fileoff:
                limit = min(limit, seg.fileoff)
            for s in seg.sections:
                if s.offset and (s.flags & 0xFF) not in S_ZEROFILL_TYPES and s.size:
                    limit = min(limit, s.offset)
        start = HEADER_SIZE + self.sizeofcmds
        if limit < start:
            raise MachOError("load commands overlap content")
        gap = data[self.offset + start:self.offset + limit]
        # Only the leading run of zero bytes is free.
        return len(gap) - len(gap.lstrip(b"\0"))


def _cstr(b: bytes) -> str:
    return b.split(b"\0", 1)[0].decode("utf-8", "replace")


def _parse_slice(data: bytes, off: int, size: int) -> Slice:
    if off + HEADER_SIZE > len(data):
        raise MachOError("truncated header")
    magic, cputype, _sub, _ft, ncmds, sizeofcmds, _flags, _res = struct.unpack_from("<IiiIIIII", data, off)
    if magic != MH_MAGIC_64:
        raise MachOError(f"not a 64-bit little-endian Mach-O (magic 0x{magic:08x})")
    if HEADER_SIZE + sizeofcmds > size or ncmds > 4096:
        raise MachOError("load commands exceed slice")
    segments: list[Segment] = []
    uuid = None
    cryptid = None
    dylibs: list[str] = []
    p = off + HEADER_SIZE
    end = p + sizeofcmds
    for _ in range(ncmds):
        if p + 8 > end:
            raise MachOError("truncated load command")
        cmd, cmdsize = struct.unpack_from("<II", data, p)
        if cmdsize < 8 or p + cmdsize > end:
            raise MachOError(f"bad cmdsize {cmdsize} for cmd 0x{cmd:x}")
        if cmd == LC_SEGMENT_64:
            segname = _cstr(data[p + 8:p + 24])
            vmaddr, vmsize, fileoff, filesize, _mp, _ip, nsects, _fl = struct.unpack_from("<QQQQiiII", data, p + 24)
            if 72 + nsects * 80 > cmdsize:
                raise MachOError("segment sections exceed cmdsize")
            seg = Segment(segname, vmaddr, vmsize, fileoff, filesize)
            for i in range(nsects):
                q = p + 72 + i * 80
                sectname = _cstr(data[q:q + 16])
                ssegname = _cstr(data[q + 16:q + 32])
                addr, ssize, soff, _al, _ro, _nr, sflags = struct.unpack_from("<QQIIIII", data, q + 32)
                seg.sections.append(Section(ssegname, sectname, addr, ssize, soff, sflags))
            segments.append(seg)
        elif cmd == LC_UUID:
            u = data[p + 8:p + 24].hex().upper()
            uuid = f"{u[0:8]}-{u[8:12]}-{u[12:16]}-{u[16:20]}-{u[20:32]}"
        elif cmd == LC_ENCRYPTION_INFO_64:
            _coff, _csize, cryptid = struct.unpack_from("<III", data, p + 8)
        elif cmd in (LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB, LC_REEXPORT_DYLIB):
            (name_off,) = struct.unpack_from("<I", data, p + 8)
            if name_off < cmdsize:
                dylibs.append(_cstr(data[p + name_off:p + cmdsize]))
        p += cmdsize
    return Slice(off, size, cputype, ncmds, sizeofcmds, segments, uuid, cryptid, dylibs)


def parse(data: bytes) -> list[Slice]:
    if len(data) < 8:
        raise MachOError("file too small")
    (be_magic,) = struct.unpack_from(">I", data, 0)
    if be_magic in (FAT_MAGIC, FAT_MAGIC_64):
        (nfat,) = struct.unpack_from(">I", data, 4)
        if nfat == 0 or nfat > 32:
            raise MachOError(f"implausible fat arch count {nfat}")
        slices = []
        for i in range(nfat):
            if be_magic == FAT_MAGIC:
                _ct, _cs, off, size, _al = struct.unpack_from(">iiIII", data, 8 + i * 20)
            else:
                _ct, _cs, off, size, _al, _r = struct.unpack_from(">iiQQII", data, 8 + i * 32)
            if off + size > len(data):
                raise MachOError("fat slice exceeds file")
            slices.append(_parse_slice(data, off, size))
        return slices
    return [_parse_slice(data, 0, len(data))]


def insert_load_dylib(data: bytearray, sl: Slice, path: str, weak: bool = False) -> bool:
    """Append LC_LOAD_DYLIB(path) to one slice in place. Returns False if it is already present."""
    if path in sl.dylibs:
        return False
    name = path.encode() + b"\0"
    cmdsize = (24 + len(name) + 7) & ~7
    if sl.free_header_space(bytes(data)) < cmdsize:
        raise MachOError(f"not enough header padding for {cmdsize}-byte load command")
    at = sl.offset + HEADER_SIZE + sl.sizeofcmds
    cmd = struct.pack("<IIIIII", LC_LOAD_WEAK_DYLIB if weak else LC_LOAD_DYLIB, cmdsize, 24, 2, 0x10000, 0x10000)
    blob = (cmd + name).ljust(cmdsize, b"\0")
    data[at:at + cmdsize] = blob
    struct.pack_into("<II", data, sl.offset + 16, sl.ncmds + 1, sl.sizeofcmds + cmdsize)
    return True
