// c++ -std=c++20 -I../src value_rules_test.cpp ../src/AutoPlay.cpp ../src/ChainSolver.cpp -o t && ./t
#include "AutoPlay.hpp"
#include "ValueRules.hpp"

#include <cstdio>
#include <cstdlib>
#include <limits>

static int g_fail = 0;
#define CHECK(c) do { if (!(c)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #c); ++g_fail; } } while (0)

struct RecordingSink : tsum::ITouchSink {
    std::vector<std::pair<tsum::TouchPhase, tsum::Point>> ev;
    void send(tsum::TouchPhase ph, tsum::Point p) override { ev.emplace_back(ph, p); }
};

int main() {
    using tsum::PerPlayMultiplier;
    {   // increments during a play never compound
        PerPlayMultiplier m;
        CHECK(m.onObserved(0, 2, 1000) == std::nullopt);
        CHECK(m.onObserved(10, 2, 1000) == 20);
        CHECK(m.onObserved(20, 2, 1000) == std::nullopt);   // our own value read back
        CHECK(m.onObserved(25, 2, 1000) == 30);             // game added 5 raw -> raw 15
        CHECK(m.raw() == 15);
        CHECK(m.onObserved(3, 2, 1000) == 6);               // new play / recompute
        CHECK(m.raw() == 3);
    }
    {   // cap, overflow and disable
        PerPlayMultiplier m;
        CHECK(m.onObserved(600, 2, 1000) == 1000);
        CHECK(m.onObserved(std::numeric_limits<std::int64_t>::max(), 3, 1000) == std::nullopt);
        CHECK(tsum::saturatingMul(std::numeric_limits<std::int64_t>::max() / 2, 3, 5000) == 5000);
        CHECK(m.onObserved(10, 1, 1000) == std::nullopt);
        CHECK(m.onObserved(-5, 2, 1000) == std::nullopt);
    }
    {   // radius scale and restore
        tsum::ScaledFloat s;
        CHECK(s.onObserved(50.f, true, 1.5f, 1000.f) == 75.f);
        CHECK(s.onObserved(75.f, true, 1.5f, 1000.f) == std::nullopt);
        CHECK(s.onObserved(75.f, true, 2.0f, 1000.f) == 100.f);   // factor changed, original kept
        CHECK(s.onObserved(50.f, true, 2.0f, 1000.f) == 100.f);   // game reset it -> recapture
        CHECK(s.onObserved(100.f, false, 2.0f, 1000.f) == 50.f);  // restore
        CHECK(s.onObserved(50.f, false, 2.0f, 1000.f) == std::nullopt);
        CHECK(s.onObserved(std::numeric_limits<float>::infinity(), true, 2.f, 1000.f) == std::nullopt);
        CHECK(s.onObserved(600.f, true, 2.f, 1000.f) == 1000.f);  // clamped
    }
    {   // drag plan shape
        auto plan = tsum::buildDragPlan({{0, 0}, {10, 0}, {10, 10}}, 2);
        CHECK(plan.size() == 5);
        CHECK(plan.back().x == 10.f && plan.back().y == 10.f);
    }
    {   // driver: Began, Moved..., Ended, cooldown, stop releases touch
        RecordingSink sink;
        tsum::AutoPlayDriver d(sink, {1, 2});
        std::vector<tsum::Tsum> board{{1, 0, 0}, {1, 10, 0}, {1, 20, 0}};
        tsum::Affine2D xf{2.f, 2.f, 100.f, 0.f};
        d.tick(board, 12.f, xf);  // plans
        CHECK(sink.ev.empty());
        for (int i = 0; i < 3; ++i) d.tick(board, 12.f, xf);
        CHECK(sink.ev.size() == 4);
        CHECK(sink.ev.front().first == tsum::TouchPhase::Began);
        CHECK(sink.ev.back().first == tsum::TouchPhase::Ended);
        const float ex = sink.ev.front().second.x;
        CHECK(ex == 100.f || ex == 140.f);
        d.tick(board, 12.f, xf); d.tick(board, 12.f, xf);  // cooldown
        CHECK(sink.ev.size() == 4);
        d.tick(board, 12.f, xf);  // replans
        d.tick(board, 12.f, xf);  // Began
        d.stop();
        CHECK(sink.ev.back().first == tsum::TouchPhase::Ended);
        CHECK(!d.dragging());
    }
    std::printf(g_fail ? "%d failure(s)\n" : "all value rule / autoplay tests passed\n", g_fail);
    return g_fail ? EXIT_FAILURE : EXIT_SUCCESS;
}
