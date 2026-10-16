import SwiftUI

@main
struct VideoSnifferApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("第一次使用请按顺序操作") {
                    StepRow(n: 1, text: "设置 → Safari 浏览器 → 扩展 → 视频嗅探 → 打开")
                    StepRow(n: 2, text: "同一页把权限改成「允许」，想全站生效就选「所有网站」")
                    StepRow(n: 3, text: "回到 Safari 打开视频页，右下角会出现蓝色按钮")
                    StepRow(n: 4, text: "播放视频 2～3 秒，再点该按钮看列表")
                }

                Section("说明") {
                    Text("这个 App 本身不下载视频，真正干活的是它内置的 Safari 扩展。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text("扩展比油猴脚本强的地方：它可以跨域读取视频地址，网页脚本做不到这一点。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section {
                    Button {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        Label("打开系统设置", systemImage: "gear")
                    }
                }
            }
            .navigationTitle("视频嗅探")
        }
    }
}

private struct StepRow: View {
    let n: Int
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(n)")
                .font(.caption.bold())
                .foregroundStyle(.white)
                .frame(width: 20, height: 20)
                .background(Circle().fill(Color.accentColor))
            Text(text).font(.callout)
        }
        .padding(.vertical, 2)
    }
}
