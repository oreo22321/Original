// Build & run (any host): c++ -std=c++20 -I../src chain_solver_test.cpp ../src/ChainSolver.cpp -o t && ./t
#include "ChainSolver.hpp"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>

using tsum::Tsum;

static int g_fail = 0;
#define CHECK(c) do { if (!(c)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #c); ++g_fail; } } while (0)

static bool validChain(const std::vector<Tsum>& b, const tsum::ChainResult& r, float radius) {
    for (std::size_t i = 0; i < r.path.size(); ++i) {
        if (b[r.path[i]].kind != r.kind) return false;
        for (std::size_t j = 0; j < i; ++j) if (r.path[j] == r.path[i]) return false;
        if (i > 0) {
            const Tsum& a = b[r.path[i - 1]];
            const Tsum& c = b[r.path[i]];
            if (std::hypot(a.x - c.x, a.y - c.y) > radius) return false;
        }
    }
    return true;
}

int main() {
    {   // straight line of 5 kind-1 plus noise
        std::vector<Tsum> b{{1, 0, 0}, {1, 10, 0}, {1, 20, 0}, {1, 30, 0}, {1, 40, 0}, {2, 0, 10}, {2, 100, 100}, {2, 200, 200}};
        auto r = tsum::findBestChain(b, 12.0f);
        CHECK(r.kind == 1);
        CHECK(r.path.size() == 5);
        CHECK(validChain(b, r, 12.0f));
    }
    {   // nothing reaches minChain
        std::vector<Tsum> b{{1, 0, 0}, {1, 100, 0}, {2, 0, 0}, {2, 0, 5}};
        auto r = tsum::findBestChain(b, 12.0f);
        CHECK(r.path.empty());
        CHECK(r.kind == -1);
    }
    {   // bigger group but disconnected loses to a smaller connected one
        std::vector<Tsum> b{{1, 0, 0}, {1, 100, 0}, {1, 200, 0}, {1, 300, 0}, {2, 0, 50}, {2, 10, 50}, {2, 20, 50}};
        auto r = tsum::findBestChain(b, 12.0f);
        CHECK(r.kind == 2);
        CHECK(r.path.size() == 3);
    }
    {   // non-finite input ignored, bad radius rejected
        const float nan = std::numeric_limits<float>::quiet_NaN();
        std::vector<Tsum> b{{1, 0, 0}, {1, nan, 0}, {1, 10, 0}, {1, 20, 0}};
        auto r = tsum::findBestChain(b, 12.0f);
        CHECK(r.path.size() == 3);
        CHECK(validChain(b, r, 12.0f));
        CHECK(tsum::findBestChain(b, nan).path.empty());
        CHECK(tsum::findBestChain(b, -1.0f).path.empty());
    }
    {   // dense grid: path must be valid and the budget must bound work
        std::vector<Tsum> b;
        for (int y = 0; y < 7; ++y) for (int x = 0; x < 7; ++x) b.push_back({0, x * 10.0f, y * 10.0f});
        tsum::SolverLimits lim; lim.nodeBudget = 5000;
        auto r = tsum::findBestChain(b, 15.0f, lim);
        CHECK(r.path.size() >= 3);
        CHECK(validChain(b, r, 15.0f));
    }
    std::printf(g_fail ? "%d failure(s)\n" : "all chain solver tests passed\n", g_fail);
    return g_fail ? EXIT_FAILURE : EXIT_SUCCESS;
}
