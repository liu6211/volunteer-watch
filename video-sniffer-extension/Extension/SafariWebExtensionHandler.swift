import SafariServices

/// Safari 会用它来处理 `browser.runtime.sendNativeMessage`。
/// 目前只用来回传版本号，方便在扩展里确认原生侧是否活着。
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        let response = NSExtensionItem()
        response.userInfo = [
            SFExtensionMessageKey: [
                "ok": true,
                "from": "native",
                "received": String(describing: message ?? "none")
            ]
        ]

        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
