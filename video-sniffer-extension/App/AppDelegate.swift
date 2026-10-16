//
//  AppDelegate.swift
//  处理：后台下载完成回调、URL Scheme 唤起
//

import UIKit

class AppDelegate: NSObject, UIApplicationDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        DownloadManager.shared.restoreTasks()
        return true
    }

    /// App 被系统在后台唤醒，用来处理后台下载完成的事件。
    /// 必须把 completionHandler 交给 DownloadManager，等所有事件处理完再调用。
    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        DownloadManager.shared.backgroundCompletionHandler = completionHandler
    }

    /// Safari 扩展用 videosniffer://add?url=... 唤起本 App
    func application(
        _ app: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        DownloadManager.shared.handleIncomingURL(url)
        return true
    }
}
