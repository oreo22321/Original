#pragma once
// Image lookup, build validation and fault-safe memory access inside the game process.

#include "GameConfig.hpp"

#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace tsum {

struct GameImage {
    std::uintptr_t base = 0;  // mach header address == __TEXT.vmaddr + slide
    std::uintptr_t end = 0;   // highest mapped segment end (excluding __PAGEZERO)
    std::uintptr_t textEnd = 0;
    std::optional<std::array<std::uint8_t, 16>> uuid;
    std::string path;
    [[nodiscard]] bool contains(std::uintptr_t a, std::size_t n = 1) const { return a >= base && a <= end && n <= end - a; }
    [[nodiscard]] bool inText(std::uintptr_t a) const { return a >= base && a < textEnd; }
};

std::optional<GameImage> findImage(std::string_view basename);

struct IdentityCheck {
    bool ok = false;
    std::string reason;          // Japanese, shown in the menu when !ok
    std::optional<GameImage> image;
};
IdentityCheck checkIdentity();   // compares the running app against config::kBuild

namespace mem {
bool read(std::uintptr_t addr, void* out, std::size_t n);
bool write(std::uintptr_t addr, const void* src, std::size_t n);
bool plausiblePointer(std::uintptr_t p);
std::optional<std::uintptr_t> readPointer(std::uintptr_t addr);
std::optional<std::uintptr_t> resolve(const GameImage& img, const config::PointerChain& chain);
std::optional<std::int64_t> readInt(std::uintptr_t addr, config::ValueType t);
bool writeInt(std::uintptr_t addr, config::ValueType t, std::int64_t v);
std::optional<float> readFloat(std::uintptr_t addr);
bool writeFloat(std::uintptr_t addr, float v);
}  // namespace mem

void log(const char* fmt, ...) __attribute__((format(printf, 1, 2)));

}  // namespace tsum
