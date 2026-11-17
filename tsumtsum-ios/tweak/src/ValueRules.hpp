#pragma once
// Pure decision logic for value edits. No memory access here; Features.mm feeds observed
// values in and writes what these return. Tested in tests/value_rules_test.cpp.

#include <cmath>
#include <cstdint>
#include <limits>
#include <optional>

namespace tsum {

inline std::int64_t saturatingMul(std::int64_t v, std::int64_t m, std::int64_t cap) {
    if (v <= 0 || m <= 0) return 0;
    if (v > cap / m) return cap;
    const std::int64_t r = v * m;
    return r > cap ? cap : r;
}

// Multiplies a per-play counter that the game increases during a play.
// Tracks the game's own (raw) total so repeated writes never compound:
//   observed == lastWritten        -> nothing new
//   observed >  lastWritten        -> game added (observed - lastWritten) raw units
//   observed <  lastWritten        -> game reset or recomputed: observed is the new raw
class PerPlayMultiplier {
public:
    std::optional<std::int64_t> onObserved(std::int64_t observed, std::int64_t mul, std::int64_t cap) {
        if (mul <= 1 || observed < 0 || observed > cap) { reset(); return std::nullopt; }
        if (lastWritten_ && observed == *lastWritten_) return std::nullopt;
        if (lastWritten_ && observed > *lastWritten_) raw_ += observed - *lastWritten_;
        else raw_ = observed;
        if (raw_ == 0) { lastWritten_ = 0; return std::nullopt; }
        const std::int64_t target = saturatingMul(raw_, mul, cap);
        lastWritten_ = target;
        if (target == observed) return std::nullopt;
        return target;
    }
    void reset() { lastWritten_.reset(); raw_ = 0; }
    [[nodiscard]] std::int64_t raw() const { return raw_; }

private:
    std::optional<std::int64_t> lastWritten_;
    std::int64_t raw_ = 0;
};

// Scales a float the game owns (link radius) and restores it when disabled.
class ScaledFloat {
public:
    // Returns the value to write, if any. `enabled == false` restores the captured original once.
    std::optional<float> onObserved(float observed, bool enabled, float factor, float maxValue) {
        if (!std::isfinite(observed) || observed <= 0.0f || observed > maxValue) return std::nullopt;
        if (!enabled) {
            if (original_ && written_ && observed == *written_) {
                const float o = *original_;
                original_.reset(); written_.reset();
                return o;
            }
            original_.reset(); written_.reset();
            return std::nullopt;
        }
        if (!std::isfinite(factor) || factor <= 0.0f) return std::nullopt;
        if (!written_ || observed != *written_) original_ = observed;  // first time, or game reset it
        float target = *original_ * factor;
        if (!std::isfinite(target) || target > maxValue) target = maxValue;
        if (target == observed) { written_ = target; return std::nullopt; }
        written_ = target;
        return target;
    }
    [[nodiscard]] std::optional<float> original() const { return original_; }

private:
    std::optional<float> original_;
    std::optional<float> written_;
};

}  // namespace tsum
