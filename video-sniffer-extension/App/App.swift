import SwiftUI

@main
struct VideoSnifferApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var dm = DownloadManager.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(dm)
                // Safari 扩展用 videosniffer://add?url=… 把任务丢进来
                .onOpenURL { url in
                    dm.handleIncomingURL(url)
                }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                dm.restoreTasks()
            }
        }
    }
}
