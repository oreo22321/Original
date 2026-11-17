#include "Features.hpp"

#include <cmath>

namespace tsum {

namespace {

// Calls the game's own touch handler. Only constructed when kTouchBackend == GameFunction,
// the RVA is set and lands in the image's __TEXT. Prototype: see GameConfig.hpp.
class GameFunctionSink final : public ITouchSink {
public:
    using Fn = void (*)(int, float, float);
    explicit GameFunctionSink(Fn fn) : fn_(fn) {}
    void send(TouchPhase phase, Point p) override { fn_(static_cast<int>(phase), p.x, p.y); }

private:
    Fn fn_;
};

Availability unavailable(const char* why) { return {false, why}; }

}  // namespace

FeatureHub& FeatureHub::instance() {
    static FeatureHub hub;
    return hub;
}

void FeatureHub::init() {
    identity_ = checkIdentity();
    if (!identity_.ok) {
        const Availability a{false, identity_.reason};
        autoPlayAvail = chainAvail = coinAvail = expAvail = a;
        log("disabled: %s", identity_.reason.c_str());
        return;
    }
    coinAvail = config::kPlayCoins.isSet() ? Availability{true, ""} : unavailable("kPlayCoins 未設定");
    expAvail = config::kPlayExp.isSet() ? Availability{true, ""} : unavailable("kPlayExp 未設定");
    chainAvail = config::kChainLinkRadius.isSet() && config::kChainLinkRadius.type == config::ValueType::Float32
                     ? Availability{true, ""}
                     : unavailable("kChainLinkRadius 未設定 (Float32 必須)");

    if (!config::kBoard.isSet()) autoPlayAvail = unavailable("kBoard 未設定");
    else if (!config::kBoardToScreen.isSet()) autoPlayAvail = unavailable("kBoardToScreen 未設定");
    else if (!config::kChainLinkRadius.isSet() && !config::kSolverLinkRadiusFallback)
        autoPlayAvail = unavailable("リンク半径が不明");
    else if (config::kTouchBackend != config::TouchBackend::GameFunction || !config::kTouchHandlerRva)
        autoPlayAvail = unavailable("タッチ送信方法 未設定");
    else {
        const std::uintptr_t fn = identity_.image->base + static_cast<std::uintptr_t>(*config::kTouchHandlerRva);
        if (!identity_.image->inText(fn) || (fn & 3) != 0) {
            autoPlayAvail = unavailable("kTouchHandlerRva が __TEXT 外");
        } else {
            sink_ = std::make_unique<GameFunctionSink>(reinterpret_cast<GameFunctionSink::Fn>(fn));
            driver_ = std::make_unique<AutoPlayDriver>(*sink_, AutoPlayTiming{});
            autoPlayAvail = {true, ""};
        }
    }
    log("availability: auto=%d chain=%d coin=%d exp=%d", autoPlayAvail.ok, chainAvail.ok, coinAvail.ok, expAvail.ok);
}

void FeatureHub::setAutoPlay(bool on) {
    if (!autoPlayAvail.ok) on = false;
    if (!on && driver_) driver_->stop();
    autoPlay = on;
}

void FeatureHub::onFocusLost() { setAutoPlay(false); }

void FeatureHub::tickMultiplier(const config::ValueLocation& loc, PerPlayMultiplier& rule, int mul, std::int64_t cap,
                                const char* tag) {
    if (mul <= 1) { rule.reset(); return; }
    const auto addr = mem::resolve(*identity_.image, loc.chain);
    if (!addr) { rule.reset(); return; }  // object not alive (e.g. outside a play)
    const auto cur = mem::readInt(*addr, *loc.type);
    if (!cur) { rule.reset(); return; }
    if (const auto target = rule.onObserved(*cur, mul, cap)) {
        if (!mem::writeInt(*addr, *loc.type, *target)) {
            if (++writeFailures_ <= 5) log("%s write failed at 0x%lx", tag, static_cast<unsigned long>(*addr));
            rule.reset();
        }
    }
}

std::optional<float> FeatureHub::solverRadius() const {
    if (config::kChainLinkRadius.isSet() && config::kChainLinkRadius.type == config::ValueType::Float32) {
        if (const auto a = mem::resolve(*identity_.image, config::kChainLinkRadius.chain))
            if (const auto r = mem::readFloat(*a); r && *r > 0.0f && *r <= config::kMaxLinkRadius) return r;
    }
    return config::kSolverLinkRadiusFallback;
}

bool FeatureHub::snapshotBoard(std::vector<Tsum>& out) const {
    out.clear();
    const auto& L = config::kBoard;
    const auto list = mem::resolve(*identity_.image, L.listHeader);
    if (!list) return false;
    const auto items = mem::readPointer(*list + static_cast<std::uintptr_t>(*L.itemsPtrOff));
    std::int32_t count = 0;
    if (!items || !mem::read(*list + static_cast<std::uintptr_t>(*L.countOff), &count, 4)) return false;
    if (count < 0 || count > config::kMaxBoardTsums) return false;

    std::uintptr_t ptrs[config::kMaxBoardTsums];
    if (count > 0 && !mem::read(*items, ptrs, sizeof(std::uintptr_t) * static_cast<std::size_t>(count))) return false;
    for (std::int32_t i = 0; i < count; ++i) {
        const std::uintptr_t t = ptrs[i];
        if (!mem::plausiblePointer(t)) continue;
        Tsum ts;
        if (!mem::read(t + static_cast<std::uintptr_t>(*L.tsumTypeOff), &ts.kind, 4)) continue;
        if (!mem::read(t + static_cast<std::uintptr_t>(*L.tsumPosXOff), &ts.x, 4)) continue;
        if (!mem::read(t + static_cast<std::uintptr_t>(*L.tsumPosYOff), &ts.y, 4)) continue;
        if (!std::isfinite(ts.x) || !std::isfinite(ts.y) || std::fabs(ts.x) > 1e5f || std::fabs(ts.y) > 1e5f) continue;
        if (L.tsumAliveOff) {
            std::uint8_t alive = 0;
            if (!mem::read(t + static_cast<std::uintptr_t>(*L.tsumAliveOff), &alive, 1) || !alive) continue;
        }
        out.push_back(ts);
    }
    return true;
}

void FeatureHub::tick() {
    if (!identity_.ok) return;

    if (coinAvail.ok) tickMultiplier(config::kPlayCoins, coinRule_, coinMul, config::kMaxPlayCoins, "coin");
    if (expAvail.ok) tickMultiplier(config::kPlayExp, expRule_, expMul, config::kMaxPlayExp, "exp");

    if (chainAvail.ok) {
        if (const auto a = mem::resolve(*identity_.image, config::kChainLinkRadius.chain)) {
            if (const auto cur = mem::readFloat(*a)) {
                if (const auto target = radiusRule_.onObserved(*cur, chainAssist, chainFactor, config::kMaxLinkRadius))
                    if (!mem::writeFloat(*a, *target) && ++writeFailures_ <= 5) log("radius write failed");
            }
        }
    }

    if (autoPlay && driver_) {
        const auto radius = solverRadius();
        if (!radius || !snapshotBoard(board_)) {
            driver_->stop();  // board gone (menu, result screen): never leave a touch held
            return;
        }
        const auto& m = config::kBoardToScreen;
        driver_->tick(board_, *radius, Affine2D{*m.scaleX, *m.scaleY, *m.offsetX, *m.offsetY});
    }
}

}  // namespace tsum
