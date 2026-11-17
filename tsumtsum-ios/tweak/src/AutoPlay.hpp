#pragma once
// Auto-play driver: turns a solved chain into a timed touch sequence, one event per tick.
// Pure: board snapshots come in, touch events go out through ITouchSink. Tested in tests/.

#include "ChainSolver.hpp"

#include <cstdint>
#include <optional>
#include <vector>

namespace tsum {

enum class TouchPhase : std::int32_t { Began = 0, Moved = 1, Ended = 2 };

struct Point { float x = 0.0f, y = 0.0f; };

struct Affine2D {  // screen = board * scale + offset
    float sx = 1.0f, sy = 1.0f, ox = 0.0f, oy = 0.0f;
    [[nodiscard]] Point apply(float x, float y) const { return {x * sx + ox, y * sy + oy}; }
};

class ITouchSink {
public:
    virtual ~ITouchSink() = default;
    virtual void send(TouchPhase phase, Point p) = 0;
};

struct AutoPlayTiming {
    int stepsPerSegment = 3;   // interpolated Moved events between two tsum centres
    int cooldownTicks = 20;    // ticks to wait after Ended before reading the board again
};

class AutoPlayDriver {
public:
    AutoPlayDriver(ITouchSink& sink, AutoPlayTiming timing) : sink_(sink), timing_(timing) {}

    // Call once per frame while enabled. `board` is only consulted when idle.
    void tick(const std::vector<Tsum>& board, float linkRadius, const Affine2D& toScreen);

    // Ends any drag in progress (Ended at last point) so the game never sees a stuck touch.
    void stop();

    [[nodiscard]] bool dragging() const { return index_ < plan_.size(); }

private:
    ITouchSink& sink_;
    AutoPlayTiming timing_;
    std::vector<Point> plan_;
    std::size_t index_ = 0;
    int cooldown_ = 0;
    std::optional<Point> lastSent_;
};

// Exposed for tests: centres -> Began, interpolated Moved..., Ended.
std::vector<Point> buildDragPlan(const std::vector<Point>& centres, int stepsPerSegment);

}  // namespace tsum
