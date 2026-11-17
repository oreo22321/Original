#include "AutoPlay.hpp"

#include <algorithm>

namespace tsum {

std::vector<Point> buildDragPlan(const std::vector<Point>& centres, int stepsPerSegment) {
    std::vector<Point> out;
    if (centres.empty()) return out;
    const int steps = std::max(1, stepsPerSegment);
    out.push_back(centres.front());
    for (std::size_t i = 1; i < centres.size(); ++i) {
        const Point a = centres[i - 1], b = centres[i];
        for (int s = 1; s <= steps; ++s) {
            const float t = static_cast<float>(s) / static_cast<float>(steps);
            out.push_back({a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t});
        }
    }
    return out;  // first = Began, middle = Moved, last also gets an Ended
}

void AutoPlayDriver::tick(const std::vector<Tsum>& board, float linkRadius, const Affine2D& toScreen) {
    if (dragging()) {
        const Point p = plan_[index_];
        const bool first = index_ == 0;
        const bool last = index_ + 1 == plan_.size();
        sink_.send(first ? TouchPhase::Began : TouchPhase::Moved, p);
        lastSent_ = p;
        ++index_;
        if (last) {
            sink_.send(TouchPhase::Ended, p);
            lastSent_.reset();
            cooldown_ = timing_.cooldownTicks;
        }
        return;
    }
    if (cooldown_ > 0) { --cooldown_; return; }

    const ChainResult chain = findBestChain(board, linkRadius);
    if (chain.path.empty()) return;
    std::vector<Point> centres;
    centres.reserve(chain.path.size());
    for (std::size_t i : chain.path) centres.push_back(toScreen.apply(board[i].x, board[i].y));
    plan_ = buildDragPlan(centres, timing_.stepsPerSegment);
    index_ = 0;
}

void AutoPlayDriver::stop() {
    if (lastSent_) sink_.send(TouchPhase::Ended, *lastSent_);
    lastSent_.reset();
    plan_.clear();
    index_ = 0;
    cooldown_ = 0;
}

}  // namespace tsum
