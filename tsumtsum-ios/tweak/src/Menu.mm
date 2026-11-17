// Floating "TM" button + settings panel in a pass-through overlay window.
#import <UIKit/UIKit.h>

#include "Features.hpp"

using tsum::FeatureHub;

@interface TMOverlayWindow : UIWindow
@end

@implementation TMOverlayWindow
- (UIView*)hitTest:(CGPoint)point withEvent:(UIEvent*)event {
    UIView* hit = [super hitTest:point withEvent:event];
    // Touches on empty overlay area fall through to the game.
    return (hit == self || hit == self.rootViewController.view) ? nil : hit;
}
@end

@interface TMMenuController : UIViewController
@property(nonatomic, strong) UIButton* toggle;
@property(nonatomic, strong) UIView* panel;
@property(nonatomic, strong) UILabel* chainValue;
@property(nonatomic, strong) UILabel* coinValue;
@property(nonatomic, strong) UILabel* expValue;
@property(nonatomic, strong) UISwitch* autoSwitch;
@end

@implementation TMMenuController

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = UIColor.clearColor;

    self.toggle = [UIButton buttonWithType:UIButtonTypeSystem];
    self.toggle.frame = CGRectMake(12, 120, 48, 48);
    self.toggle.backgroundColor = [UIColor colorWithWhite:0.1 alpha:0.75];
    self.toggle.layer.cornerRadius = 24;
    [self.toggle setTitle:@"TM" forState:UIControlStateNormal];
    [self.toggle setTitleColor:UIColor.whiteColor forState:UIControlStateNormal];
    [self.toggle addTarget:self action:@selector(togglePanel) forControlEvents:UIControlEventTouchUpInside];
    [self.toggle addGestureRecognizer:[[UIPanGestureRecognizer alloc] initWithTarget:self action:@selector(drag:)]];
    [self.view addSubview:self.toggle];

    [self buildPanel];
}

- (void)drag:(UIPanGestureRecognizer*)g {
    const CGPoint d = [g translationInView:self.view];
    CGPoint c = CGPointMake(g.view.center.x + d.x, g.view.center.y + d.y);
    const CGRect b = self.view.bounds;
    c.x = MAX(24, MIN(CGRectGetMaxX(b) - 24, c.x));
    c.y = MAX(24, MIN(CGRectGetMaxY(b) - 24, c.y));
    g.view.center = c;
    [g setTranslation:CGPointZero inView:self.view];
}

- (void)togglePanel {
    self.panel.hidden = !self.panel.hidden;
    [self refresh];
}

static UILabel* TMLabel(NSString* text, CGFloat size, UIColor* color) {
    UILabel* l = [UILabel new];
    l.text = text;
    l.font = [UIFont systemFontOfSize:size];
    l.textColor = color;
    l.numberOfLines = 0;
    return l;
}

- (UIStackView*)row:(NSString*)title control:(UIView*)control value:(UILabel*)value {
    UIStackView* r = [[UIStackView alloc] init];
    r.axis = UILayoutConstraintAxisHorizontal;
    r.spacing = 8;
    r.alignment = UIStackViewAlignmentCenter;
    UILabel* t = TMLabel(title, 14, UIColor.whiteColor);
    [t setContentHuggingPriority:UILayoutPriorityDefaultLow forAxis:UILayoutConstraintAxisHorizontal];
    [r addArrangedSubview:t];
    if (value) [r addArrangedSubview:value];
    [r addArrangedSubview:control];
    return r;
}

- (void)addFeature:(UIStackView*)stack
             title:(NSString*)title
           control:(UIControl*)control
             value:(UILabel*)value
             avail:(const tsum::Availability&)a {
    control.enabled = a.ok;
    [stack addArrangedSubview:[self row:title control:control value:value]];
    if (!a.ok)
        [stack addArrangedSubview:TMLabel([NSString stringWithUTF8String:a.reason.c_str()], 11, UIColor.systemRedColor)];
}

- (UIStepper*)stepperMin:(double)lo max:(double)hi step:(double)st value:(double)v action:(SEL)sel {
    UIStepper* s = [UIStepper new];
    s.minimumValue = lo; s.maximumValue = hi; s.stepValue = st; s.value = v;
    [s addTarget:self action:sel forControlEvents:UIControlEventValueChanged];
    return s;
}

- (void)buildPanel {
    FeatureHub& hub = FeatureHub::instance();

    self.panel = [UIView new];
    self.panel.backgroundColor = [UIColor colorWithWhite:0.08 alpha:0.92];
    self.panel.layer.cornerRadius = 12;
    self.panel.hidden = YES;
    self.panel.translatesAutoresizingMaskIntoConstraints = NO;
    [self.view addSubview:self.panel];

    UIStackView* stack = [UIStackView new];
    stack.axis = UILayoutConstraintAxisVertical;
    stack.spacing = 8;
    stack.translatesAutoresizingMaskIntoConstraints = NO;
    [self.panel addSubview:stack];

    [stack addArrangedSubview:TMLabel(@"TsumMod", 16, UIColor.whiteColor)];
    const auto& id = hub.identity();
    [stack addArrangedSubview:TMLabel(id.ok ? @"ビルド: 一致" : [NSString stringWithFormat:@"ビルド: %s", id.reason.c_str()], 11,
                                      id.ok ? UIColor.systemGreenColor : UIColor.systemOrangeColor)];

    self.autoSwitch = [UISwitch new];
    [self.autoSwitch addTarget:self action:@selector(autoChanged:) forControlEvents:UIControlEventValueChanged];
    [self addFeature:stack title:@"オートプレイ" control:self.autoSwitch value:nil avail:hub.autoPlayAvail];

    UISwitch* chain = [UISwitch new];
    [chain addTarget:self action:@selector(chainChanged:) forControlEvents:UIControlEventValueChanged];
    [self addFeature:stack title:@"チェーン補正" control:chain value:nil avail:hub.chainAvail];
    self.chainValue = TMLabel(@"", 13, UIColor.lightGrayColor);
    [self addFeature:stack title:@"  半径倍率" control:[self stepperMin:1.0 max:3.0 step:0.25 value:hub.chainFactor action:@selector(chainFactorChanged:)]
               value:self.chainValue avail:hub.chainAvail];

    self.coinValue = TMLabel(@"", 13, UIColor.lightGrayColor);
    [self addFeature:stack title:@"取得コイン倍率" control:[self stepperMin:1 max:10 step:1 value:hub.coinMul action:@selector(coinChanged:)]
               value:self.coinValue avail:hub.coinAvail];

    self.expValue = TMLabel(@"", 13, UIColor.lightGrayColor);
    [self addFeature:stack title:@"取得経験値倍率" control:[self stepperMin:1 max:10 step:1 value:hub.expMul action:@selector(expChanged:)]
               value:self.expValue avail:hub.expAvail];

    UILayoutGuide* safe = self.view.safeAreaLayoutGuide;
    [NSLayoutConstraint activateConstraints:@[
        [self.panel.topAnchor constraintEqualToAnchor:safe.topAnchor constant:60],
        [self.panel.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:12],
        [self.panel.widthAnchor constraintEqualToConstant:300],
        [stack.topAnchor constraintEqualToAnchor:self.panel.topAnchor constant:12],
        [stack.bottomAnchor constraintEqualToAnchor:self.panel.bottomAnchor constant:-12],
        [stack.leadingAnchor constraintEqualToAnchor:self.panel.leadingAnchor constant:12],
        [stack.trailingAnchor constraintEqualToAnchor:self.panel.trailingAnchor constant:-12],
    ]];
    [self.view bringSubviewToFront:self.toggle];
    [self refresh];
}

- (void)refresh {
    FeatureHub& hub = FeatureHub::instance();
    self.autoSwitch.on = hub.autoPlay;
    self.chainValue.text = [NSString stringWithFormat:@"x%.2f", hub.chainFactor];
    self.coinValue.text = [NSString stringWithFormat:@"x%d", hub.coinMul];
    self.expValue.text = [NSString stringWithFormat:@"x%d", hub.expMul];
}

- (void)autoChanged:(UISwitch*)s { FeatureHub::instance().setAutoPlay(s.on); [self refresh]; }
- (void)chainChanged:(UISwitch*)s { FeatureHub::instance().chainAssist = s.on; }
- (void)chainFactorChanged:(UIStepper*)s { FeatureHub::instance().chainFactor = static_cast<float>(s.value); [self refresh]; }
- (void)coinChanged:(UIStepper*)s { FeatureHub::instance().coinMul = static_cast<int>(s.value); [self refresh]; }
- (void)expChanged:(UIStepper*)s { FeatureHub::instance().expMul = static_cast<int>(s.value); [self refresh]; }

@end

static TMOverlayWindow* gOverlay;

extern "C" void TMInstallMenu(void) {
    if (gOverlay) return;
    UIWindowScene* scene = nil;
    for (UIScene* s in UIApplication.sharedApplication.connectedScenes) {
        if ([s isKindOfClass:UIWindowScene.class] && s.activationState == UISceneActivationStateForegroundActive) {
            scene = (UIWindowScene*)s;
            break;
        }
    }
    if (!scene) { tsum::log("menu: no active window scene yet"); return; }
    gOverlay = [[TMOverlayWindow alloc] initWithWindowScene:scene];
    gOverlay.frame = scene.coordinateSpace.bounds;
    gOverlay.windowLevel = UIWindowLevelAlert + 1;
    gOverlay.backgroundColor = UIColor.clearColor;
    gOverlay.rootViewController = [TMMenuController new];
    gOverlay.hidden = NO;  // visible without becoming key, so the game keeps keyboard/focus
    tsum::log("menu installed");
}
