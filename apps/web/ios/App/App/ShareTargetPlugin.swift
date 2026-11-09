import Foundation
import Capacitor

/**
 * ShareTargetPlugin for iOS
 *
 * NOTE / TODO FOR iOS SHARE EXTENSION:
 * On iOS, apps cannot act as a share target solely through Info.plist or standard URL schemes.
 * iOS requires an independent "Share Extension" target (a separate app extension process with its own sandbox).
 *
 * To complete the iOS Share Extension implementation when building with Xcode:
 * 1. Add a "Share Extension" target in Amethyst.xcodeproj named "AmethystShareExtension".
 * 2. Configure an App Group (e.g., `group.app.amethyst.companion`) in both the main app and extension targets.
 * 3. Enable Keychain Sharing in Capabilities for both targets so `bundle.js` credentials can be read by the extension.
 * 4. In `ShareViewController.swift`, extract the shared text/URL from `extensionContext?.inputItems` via `NSItemProvider`.
 * 5. Write the incoming job to the shared App Group container (or launch the main app via URL scheme `amethyst://share?text=...`).
 *
 * The Capacitor plugin below provides the runtime bridge for the main iOS app when receiving shared payloads.
 */
@objc(ShareTargetPlugin)
public class ShareTargetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareTargetPlugin"
    public let jsName = "ShareTarget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getSharedItem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSharedItem", returnType: CAPPluginReturnPromise)
    ]

    private var lastSharedItem: [String: Any]? = nil

    @objc public func getSharedItem(_ call: CAPPluginCall) {
        if let item = lastSharedItem {
            call.resolve(item)
        } else {
            call.resolve([:])
        }
    }

    @objc public func clearSharedItem(_ call: CAPPluginCall) {
        lastSharedItem = nil
        call.resolve()
    }

    public func setSharedItem(_ item: [String: Any]) {
        self.lastSharedItem = item
        notifyListeners("shareReceived", data: item)
    }
}
