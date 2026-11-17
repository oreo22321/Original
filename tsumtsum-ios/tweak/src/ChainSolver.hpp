#pragma once
// Pure chain search: no game or OS dependencies, unit-tested in tests/chain_solver_test.cpp.

#include <cstddef>
#include <cstdint>
#include <vector>

namespace tsum {

struct Tsum {
    std::int32_t kind = 0;
    float x = 0.0f;
    float y = 0.0f;
};

struct ChainResult {
    std::vector<std::size_t> path;  // indices into the input board, in drag order
    std::int32_t kind = -1;
};

struct SolverLimits {
    std::size_t minChain = 3;          // shortest chain worth dragging
    std::size_t maxChain = 64;
    std::size_t nodeBudget = 200'000;  // total DFS expansions per solve, keeps a frame bounded
};

// Two tsums link when they share a kind and centre distance <= linkRadius.
// Returns the longest chain found within the budget (exact for small boards,
// best-so-far when the budget runs out). Empty path if nothing reaches minChain.
// Non-finite coordinates or radius make the tsum / call ignored.
ChainResult findBestChain(const std::vector<Tsum>& board, float linkRadius, const SolverLimits& limits = {});

}  // namespace tsum
