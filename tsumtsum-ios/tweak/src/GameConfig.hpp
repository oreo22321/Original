#pragma once
// Every build-dependent value of the game lives in this file and nowhere else.
//
// STATUS: NO VALUE HERE HAS BEEN TAKEN FROM THE GAME YET.
// All locations are UNSET. A feature whose inputs are unset stays disabled in the
// menu and shows why. Fill values only from your own decrypted binary / dumps of
// one exact build, and record that build in kBuild below.
//
// Address kinds used here:
//   rva  = offset from the load address of the image named in kBuild.imageName
//          (i.e. vmaddr - __TEXT.vmaddr in IDA/Ghidra with base 0). NOT a file offset.
//   offsets in a chain = byte offsets applied after dereferencing.

#include <array>
#include <cstdint>
#include <optional>
#include <string_view>

namespace tsum::config {

struct BuildIdentity {
    std::string_view bundleId;                         // CFBundleIdentifier
    std::string_view version;                          // CFBundleShortVersionString
    std::string_view imageName;                        // basename of the image with game code
    std::optional<std::array<std::uint8_t, 16>> uuid;  // LC_UUID of that image (tools/ipa_recon.py prints it)
};

// UNSET. Example of a filled entry (not real data):
//   { "com.example.game", "1.2.3", "GameBinary", std::array<std::uint8_t,16>{0x..} }
inline constexpr BuildIdentity kBuild{"", "", "", std::nullopt};

enum class ValueType : std::uint8_t { Int32, Int64, Float32 };

// Static pointer at image+baseRva, then: p = *p; p += offsets[i] ... ; final p is the field address.
// For depth == 0 the field is at image+baseRva itself.
struct PointerChain {
    std::optional<std::uint64_t> baseRva;
    std::array<std::int64_t, 8> offsets{};
    std::uint8_t depth = 0;
    [[nodiscard]] constexpr bool isSet() const { return baseRva.has_value() && depth <= offsets.size(); }
};

struct ValueLocation {
    PointerChain chain;
    std::optional<ValueType> type;  // unknown until confirmed (the game may also store values obfuscated)
    [[nodiscard]] constexpr bool isSet() const { return chain.isSet() && type.has_value(); }
};

// ---------------------------------------------------------------------------
// Coins earned in the current play (the per-play number, NOT the wallet total).
inline constexpr ValueLocation kPlayCoins{};          // UNSET
// Experience earned in the current play.
inline constexpr ValueLocation kPlayExp{};            // UNSET
// Link distance used when a drag connects two tsums (chain assist scales it).
inline constexpr ValueLocation kChainLinkRadius{};    // UNSET

// Sanity bounds used before any write. These are tool limits, not game data.
inline constexpr std::int64_t kMaxPlayCoins = 1'000'000;
inline constexpr std::int64_t kMaxPlayExp = 10'000'000;
inline constexpr float kMaxLinkRadius = 10'000.0f;

// ---------------------------------------------------------------------------
// Auto play: the board must be readable and touches must be deliverable.
struct BoardLayout {
    PointerChain listHeader;                    // address of the container holding tsum pointers
    std::optional<std::int64_t> itemsPtrOff;    // offset in the container -> pointer to T* array
    std::optional<std::int64_t> countOff;       // offset in the container -> int32 count
    std::optional<std::int64_t> tsumTypeOff;    // offset in a tsum -> int32 kind id
    std::optional<std::int64_t> tsumPosXOff;    // offset in a tsum -> float x (board space)
    std::optional<std::int64_t> tsumPosYOff;    // offset in a tsum -> float y (board space)
    std::optional<std::int64_t> tsumAliveOff;   // optional: offset -> uint8 "linkable" flag
    [[nodiscard]] constexpr bool isSet() const {
        return listHeader.isSet() && itemsPtrOff && countOff && tsumTypeOff && tsumPosXOff && tsumPosYOff;
    }
};
inline constexpr BoardLayout kBoard{};                // UNSET
inline constexpr std::int32_t kMaxBoardTsums = 128;   // tool bound, not game data

// Board space -> screen points: screen = board * scale + offset.
struct BoardToScreen {
    std::optional<float> scaleX, scaleY, offsetX, offsetY;
    [[nodiscard]] constexpr bool isSet() const { return scaleX && scaleY && offsetX && offsetY; }
};
inline constexpr BoardToScreen kBoardToScreen{};      // UNSET

// Link radius in board space used by the solver when kChainLinkRadius is not readable.
inline constexpr std::optional<float> kSolverLinkRadiusFallback{};  // UNSET

// How touches reach the game. Chosen after the engine is identified (see README):
//   None        -> auto play stays disabled
//   GameFunction-> call the game's own touch handler (needs rva + confirmed prototype)
enum class TouchBackend : std::uint8_t { None, GameFunction };
inline constexpr TouchBackend kTouchBackend = TouchBackend::None;  // UNSET
// For GameFunction: void handler(int phase /*0 began,1 moved,2 ended*/, float x, float y).
// That prototype is a requirement of this tool, not a claim about the game: you must
// confirm the real handler matches it (or adapt TouchSink.mm) before setting this.
inline constexpr std::optional<std::uint64_t> kTouchHandlerRva{};  // UNSET

}  // namespace tsum::config
