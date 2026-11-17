// Load-time entry: wait for the app to become active, then init features, menu and the frame tick.
#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>

#include "Features.hpp"

extern "C" void TMInstallMenu(void);

@interface TMTicker : NSObject
@property(nonatomic, strong) CADisplayLink* link;
@end

@implementation TMTicker
- (void)start {
    self.link = [CADisplayLink displayLinkWithTarget:self selector:@selector(frame:)];
    [self.link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
}
- (void)frame:(CADisplayLink*)link {
    tsum::FeatureHub::instance().tick();
}
@end

static TMTicker* gTicker;
static bool gStarted;

static void TMStart(void) {
    if (!gStarted) {
        gStarted = true;
        tsum::log("loaded into %s", NSBundle.mainBundle.bundleIdentifier.UTF8String ?: "?");
        tsum::FeatureHub::instance().init();
        gTicker = [TMTicker new];
        [gTicker start];
    }
    TMInstallMenu();  // retried on each activation until a scene exists
}

__attribute__((constructor)) static void TMLoad(void) {
    NSNotificationCenter* nc = NSNotificationCenter.defaultCenter;
    [nc addObserverForName:UIApplicationDidBecomeActiveNotification object:nil queue:NSOperationQueue.mainQueue
                usingBlock:^(NSNotification*) { TMStart(); }];
    [nc addObserverForName:UIApplicationWillResignActiveNotification object:nil queue:NSOperationQueue.mainQueue
                usingBlock:^(NSNotification*) { tsum::FeatureHub::instance().onFocusLost(); }];
}
