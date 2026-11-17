#include "ChainSolver.hpp"

#include <algorithm>
#include <cmath>
#include <map>

namespace tsum {
namespace {

struct Search {
    const std::vector<std::vector<std::size_t>>& adj;
    std::size_t maxChain;
    std::size_t budget;
    std::vector<char> used;
    std::vector<std::size_t> cur;
    std::vector<std::size_t> best;

    void dfs(std::size_t node) {
        if (budget == 0) return;
        --budget;
        used[node] = 1;
        cur.push_back(node);
        if (cur.size() > best.size()) best = cur;
        if (cur.size() < maxChain) {
            for (std::size_t next : adj[node]) {
                if (!used[next]) dfs(next);
                if (budget == 0) break;
            }
        }
        cur.pop_back();
        used[node] = 0;
    }
};

}  // namespace

ChainResult findBestChain(const std::vector<Tsum>& board, float linkRadius, const SolverLimits& limits) {
    ChainResult result;
    if (!std::isfinite(linkRadius) || linkRadius <= 0.0f || limits.maxChain == 0) return result;

    std::map<std::int32_t, std::vector<std::size_t>> byKind;
    for (std::size_t i = 0; i < board.size(); ++i) {
        if (std::isfinite(board[i].x) && std::isfinite(board[i].y)) byKind[board[i].kind].push_back(i);
    }

    const float r2 = linkRadius * linkRadius;
    std::size_t budgetLeft = limits.nodeBudget;

    // Largest groups first: they bound the longest possible chains, so they get the budget first.
    std::vector<std::pair<std::int32_t, const std::vector<std::size_t>*>> groups;
    for (const auto& [kind, idx] : byKind) groups.emplace_back(kind, &idx);
    std::sort(groups.begin(), groups.end(),
              [](const auto& a, const auto& b) { return a.second->size() > b.second->size(); });

    for (const auto& [kind, members] : groups) {
        if (members->size() < limits.minChain || members->size() <= result.path.size()) continue;
        const std::size_t n = members->size();
        std::vector<std::vector<std::size_t>> adj(n);
        for (std::size_t a = 0; a < n; ++a) {
            for (std::size_t b = a + 1; b < n; ++b) {
                const Tsum& ta = board[(*members)[a]];
                const Tsum& tb = board[(*members)[b]];
                const float dx = ta.x - tb.x, dy = ta.y - tb.y;
                if (dx * dx + dy * dy <= r2) {
                    adj[a].push_back(b);
                    adj[b].push_back(a);
                }
            }
        }
        // Start from low-degree nodes: chain ends are usually there.
        std::vector<std::size_t> order(n);
        for (std::size_t i = 0; i < n; ++i) order[i] = i;
        std::sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) { return adj[a].size() < adj[b].size(); });

        Search s{adj, std::min(limits.maxChain, n), budgetLeft, std::vector<char>(n, 0), {}, {}};
        for (std::size_t start : order) {
            if (s.budget == 0 || s.best.size() == s.maxChain) break;
            s.dfs(start);
        }
        budgetLeft = s.budget;

        if (s.best.size() >= limits.minChain && s.best.size() > result.path.size()) {
            result.path.clear();
            for (std::size_t local : s.best) result.path.push_back((*members)[local]);
            result.kind = kind;
        }
        if (budgetLeft == 0) break;
    }
    return result;
}

}  // namespace tsum
