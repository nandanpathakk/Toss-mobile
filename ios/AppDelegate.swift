import Expo
import UIKit
import React
import ReactAppDependencyProvider
import React_RCTAppDelegate

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?
  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    if ReactNativeDelegate.usesBundledRehearsal {
      RCTDevLoadingViewSetEnabled(false)
    }
    let delegate = ReactNativeDelegate()
    delegate.dependencyProvider = RCTAppDependencyProvider()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    bindReactNativeFactory(factory)
    reactNativeDelegate = delegate
    reactNativeFactory = factory
    window = UIWindow(frame: UIScreen.main.bounds)
    window?.backgroundColor = UIColor(red: 11 / 255.0, green: 13 / 255.0, blue: 15 / 255.0, alpha: 1)
    factory.startReactNative(withModuleName: "Rainbow", in: window, launchOptions: launchOptions)
    if let rootView = window?.rootViewController?.view {
      rootView.backgroundColor = window?.backgroundColor
      RainbowSplashScreen.showSplash("LaunchScreen", inRootView: rootView)
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  override func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    let linked = RCTLinkingManager.application(app, open: url, options: options)
    return super.application(app, open: url, options: options) || linked
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Only an explicitly packaged Debug simulator copy can use synthetic UI data.
  // Normal Debug and every Release build retain their original entry paths.
  static var usesBundledRehearsal: Bool {
#if DEBUG && targetEnvironment(simulator)
    Bundle.main.object(forInfoDictionaryKey: "TossUIRehearsal") as? Bool == true
#else
    false
#endif
  }

  override func sourceURL(for bridge: RCTBridge) -> URL? { bundleURL() }

  override func bundleURL() -> URL? {
#if DEBUG
    if Self.usesBundledRehearsal {
      guard let bundled = Bundle.main.url(forResource: "toss-rehearsal", withExtension: "jsbundle") else {
        fatalError("The explicitly packaged UI rehearsal bundle is missing.")
      }
      return bundled
    }
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "panta-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
