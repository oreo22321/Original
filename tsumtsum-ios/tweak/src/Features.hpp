#pragma once
// Feature state and the per-frame update. All calls happen on the main thread
// (menu callbacks and the CADisplayLink tick), so there is no locking.

#include "AutoPlay.hpp"
#include "Runtime.hpp"
#include "ValueRules.hpp"

#include <memory>
#include <string>

namespace tsum {

struct Availability {
    bool ok = false;
    std::string reason;  // why it is disabled (Japanese, shown in the menu)
};

class FeatureHub {
public:
    static FeatureHub& instance();

    void init();      // identity check + per-feature availability; call once on the main thread
    void tick();      // once per frame
    void onFocusLost();

    // Menu-facing state
    const IdentityCheck& identity() const { return identity_; }
    Availability autoPlayAvail, chainAvail, coinAvail, expAvail;

    bool autoPlay = false;
    bool chainAssist = false;
    float chainFactor = 1.5f;
    int coinMul = 1;
    int expMul = 1;

    void setAutoPlay(bool on);

private:
    FeatureHub() = default;
    void tickMultiplier(const config::ValueLocation& loc, PerPlayMultiplier& rule, int mul, std::int64_t cap, const char* tag);
    bool snapshotBoard(std::vector<Tsum>& out) const;
    std::optional<float> solverRadius() const;

    IdentityCheck identity_;
    PerPlayMultiplier coinRule_, expRule_;
    ScaledFloat radiusRule_;
    std::unique_ptr<ITouchSink> sink_;
    std::unique_ptr<AutoPlayDriver> driver_;
    std::vector<Tsum> board_;
    int writeFailures_ = 0;
};

}  // namespace tsum
