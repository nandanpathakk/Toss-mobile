import Foundation
import React
import UIKit

@objc(RainbowSplashScreen)
class RainbowSplashScreen: NSObject {
  
  private static var addedJsLoadErrorObserver = false;
  private static var loadingView: UIView? = nil;

  // needed since RN does not see the static method
  @objc func hideAnimated() {
    RainbowSplashScreen.staticHideAnimated()
  }
  
  static func staticHideAnimated() {
    DispatchQueue.main.async {
      
      if let loadingView = loadingView {
        UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.16, delay: 0.0, options: .curveEaseOut, animations: {
          loadingView.alpha = 0.0
        }) { _ in
          self.hide()
        }
      } else {
        print("WARNING: calling hideAnimated on SplashScreen but loadingView is nil")
      }
    }
  }
  
  static func showSplash(_ splashScreen: String, inRootView rootView: UIView) {
    
    if !addedJsLoadErrorObserver {
        NotificationCenter.default.addObserver(
            forName: NSNotification.Name("RCTJavaScriptDidFailToLoadNotification"),
            object: nil,
            queue: .main
        ) { _ in
          // If there was an error loading JavaScript, hide the splash screen so it can be shown. Otherwise, the splash screen will remain forever, which is a hassle to debug.
          self.hide()
        }
        addedJsLoadErrorObserver = true
    }

    if loadingView == nil {
        guard let view = Bundle.main.loadNibNamed(splashScreen, owner: self, options: nil)?.first as? UIView else {
          print("WARNING: SplashScreen nib not found")
          return
        }
        loadingView = view
        loadingView?.frame = rootView.frame
        loadingView?.frame.origin = .zero
    }
    if let loadingView = loadingView {
        rootView.addSubview(loadingView)
    }
  }
  
  static func hide() {
    DispatchQueue.main.async {
        loadingView?.removeFromSuperview()
        loadingView = nil
    }
  }

  @objc static func requiresMainQueueSetup() -> Bool {
    return true
  }
}
