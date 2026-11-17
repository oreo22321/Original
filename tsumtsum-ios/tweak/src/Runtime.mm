#include "Runtime.hpp"

#import <Foundation/Foundation.h>

#include <mach-o/dyld.h>
#include <mach-o/loader.h>
#include <mach/mach.h>
#include <mach/vm_map.h>

#include <algorithm>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <limits>

namespace tsum {

void log(const char* fmt, ...) {
    char buf[1024];
    va_list ap;
    va_start(ap, fmt);
    std::vsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);
    NSString* line = [NSString stringWithFormat:@"[TsumMod] %s\n", buf];
    NSLog(@"%@", line);
    static NSString* path = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject
        stringByAppendingPathComponent:@"TsumMod.log"];
    if (!path) return;
    @synchronized([NSFileManager class]) {
        NSFileHandle* fh = [NSFileHandle fileHandleForWritingAtPath:path];
        if (!fh) {
            [[NSFileManager defaultManager] createFileAtPath:path contents:nil attributes:nil];
            fh = [NSFileHandle fileHandleForWritingAtPath:path];
        }
        [fh seekToEndOfFile];
        [fh writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
        [fh closeFile];
    }
}

std::optional<GameImage> findImage(std::string_view basename) {
    if (basename.empty()) return std::nullopt;
    const uint32_t count = _dyld_image_count();
    for (uint32_t i = 0; i < count; ++i) {
        const char* name = _dyld_get_image_name(i);
        if (!name) continue;
        const char* slash = std::strrchr(name, '/');
        const std::string_view base = slash ? slash + 1 : name;
        if (base != basename) continue;

        const auto* hdr = reinterpret_cast<const mach_header_64*>(_dyld_get_image_header(i));
        if (!hdr || hdr->magic != MH_MAGIC_64) return std::nullopt;
        const intptr_t slide = _dyld_get_image_vmaddr_slide(i);

        GameImage img;
        img.path = name;
        img.base = reinterpret_cast<std::uintptr_t>(hdr);
        std::uintptr_t hi = 0;
        bool sawText = false;
        const auto* lc = reinterpret_cast<const load_command*>(hdr + 1);
        for (uint32_t c = 0; c < hdr->ncmds && c < 512; ++c) {
            if (lc->cmdsize < sizeof(load_command)) return std::nullopt;
            if (lc->cmd == LC_SEGMENT_64) {
                const auto* seg = reinterpret_cast<const segment_command_64*>(lc);
                if (std::strncmp(seg->segname, SEG_PAGEZERO, 16) != 0) {
                    hi = std::max<std::uintptr_t>(hi, seg->vmaddr + seg->vmsize + slide);
                    if (std::strncmp(seg->segname, SEG_TEXT, 16) == 0) {
                        sawText = true;
                        if (seg->vmaddr + slide != img.base) return std::nullopt;  // header must sit at __TEXT start
                        img.textEnd = seg->vmaddr + seg->vmsize + slide;
                    }
                }
            } else if (lc->cmd == LC_UUID) {
                const auto* u = reinterpret_cast<const uuid_command*>(lc);
                std::array<std::uint8_t, 16> v{};
                std::memcpy(v.data(), u->uuid, 16);
                img.uuid = v;
            }
            lc = reinterpret_cast<const load_command*>(reinterpret_cast<const std::uint8_t*>(lc) + lc->cmdsize);
        }
        if (!sawText || hi <= img.base) return std::nullopt;
        img.end = hi;
        return img;
    }
    return std::nullopt;
}

static std::string uuidString(const std::array<std::uint8_t, 16>& u) {
    char s[40];
    std::snprintf(s, sizeof s, "%02X%02X%02X%02X-%02X%02X-%02X%02X-%02X%02X-%02X%02X%02X%02X%02X%02X", u[0], u[1], u[2], u[3],
                  u[4], u[5], u[6], u[7], u[8], u[9], u[10], u[11], u[12], u[13], u[14], u[15]);
    return s;
}

IdentityCheck checkIdentity() {
    IdentityCheck r;
    const auto& b = config::kBuild;
    if (b.bundleId.empty() || b.version.empty() || b.imageName.empty() || !b.uuid) {
        r.reason = "ビルド情報が未設定 (GameConfig.hpp の kBuild)";
        return r;
    }
    NSBundle* main = NSBundle.mainBundle;
    NSString* bid = main.bundleIdentifier ?: @"";
    NSString* ver = [main objectForInfoDictionaryKey:@"CFBundleShortVersionString"] ?: @"";
    // Re-signing tools may rewrite the bundle id; the UUID check below is the real identity gate.
    if (std::string_view(bid.UTF8String) != b.bundleId) log("note: bundle id %s differs from config (re-signed?)", bid.UTF8String);
    if (std::string_view(ver.UTF8String) != b.version) {
        r.reason = std::string("バージョン不一致: 実行中 ") + ver.UTF8String + " / 設定 " + std::string(b.version);
        return r;
    }
    r.image = findImage(b.imageName);
    if (!r.image) {
        r.reason = std::string("イメージが見つからない: ") + std::string(b.imageName);
        return r;
    }
    if (!r.image->uuid || *r.image->uuid != *b.uuid) {
        r.reason = "UUID 不一致: " + (r.image->uuid ? uuidString(*r.image->uuid) : std::string("なし"));
        return r;
    }
    r.ok = true;
    log("identity ok: %s base=0x%lx end=0x%lx uuid=%s", r.image->path.c_str(), static_cast<unsigned long>(r.image->base),
        static_cast<unsigned long>(r.image->end), uuidString(*r.image->uuid).c_str());
    return r;
}

namespace mem {

bool read(std::uintptr_t addr, void* out, std::size_t n) {
    if (addr == 0 || n == 0) return false;
    vm_size_t got = 0;
    const kern_return_t kr = vm_read_overwrite(mach_task_self(), static_cast<vm_address_t>(addr), n,
                                               reinterpret_cast<vm_address_t>(out), &got);
    return kr == KERN_SUCCESS && got == n;
}

bool write(std::uintptr_t addr, const void* src, std::size_t n) {
    if (addr == 0 || n == 0 || n > std::numeric_limits<mach_msg_type_number_t>::max()) return false;
    return vm_write(mach_task_self(), static_cast<vm_address_t>(addr), reinterpret_cast<vm_offset_t>(src),
                    static_cast<mach_msg_type_number_t>(n)) == KERN_SUCCESS;
}

bool plausiblePointer(std::uintptr_t p) {
    // 64-bit iOS processes map nothing below 4 GiB (__PAGEZERO); user VA is below 2^47.
    return p >= 0x100000000ull && p < (1ull << 47) && (p & 0x3) == 0;
}

std::optional<std::uintptr_t> readPointer(std::uintptr_t addr) {
    std::uintptr_t v = 0;
    if (!read(addr, &v, sizeof v) || !plausiblePointer(v)) return std::nullopt;
    return v;
}

std::optional<std::uintptr_t> resolve(const GameImage& img, const config::PointerChain& chain) {
    if (!chain.isSet()) return std::nullopt;
    if (*chain.baseRva > img.end - img.base) return std::nullopt;
    std::uintptr_t addr = img.base + static_cast<std::uintptr_t>(*chain.baseRva);
    if (!img.contains(addr, sizeof(std::uintptr_t))) return std::nullopt;
    for (std::uint8_t i = 0; i < chain.depth; ++i) {
        const auto p = readPointer(addr);
        if (!p) return std::nullopt;
        addr = *p + static_cast<std::uintptr_t>(chain.offsets[i]);
    }
    return addr;
}

std::optional<std::int64_t> readInt(std::uintptr_t addr, config::ValueType t) {
    switch (t) {
        case config::ValueType::Int32: { std::int32_t v; if (!read(addr, &v, 4)) return std::nullopt; return v; }
        case config::ValueType::Int64: { std::int64_t v; if (!read(addr, &v, 8)) return std::nullopt; return v; }
        case config::ValueType::Float32: {
            float v; if (!read(addr, &v, 4) || !std::isfinite(v) || std::fabs(v) > 9.0e15f) return std::nullopt;
            return static_cast<std::int64_t>(v);
        }
    }
    return std::nullopt;
}

bool writeInt(std::uintptr_t addr, config::ValueType t, std::int64_t v) {
    switch (t) {
        case config::ValueType::Int32: {
            if (v < std::numeric_limits<std::int32_t>::min() || v > std::numeric_limits<std::int32_t>::max()) return false;
            const std::int32_t x = static_cast<std::int32_t>(v);
            return write(addr, &x, 4);
        }
        case config::ValueType::Int64: return write(addr, &v, 8);
        case config::ValueType::Float32: { const float f = static_cast<float>(v); return write(addr, &f, 4); }
    }
    return false;
}

std::optional<float> readFloat(std::uintptr_t addr) {
    float v;
    if (!read(addr, &v, 4) || !std::isfinite(v)) return std::nullopt;
    return v;
}

bool writeFloat(std::uintptr_t addr, float v) { return std::isfinite(v) && write(addr, &v, 4); }

}  // namespace mem
}  // namespace tsum
