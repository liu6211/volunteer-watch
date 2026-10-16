//
//  Views.swift
//  界面：我的任务 / 新建任务 / 批量操作 / 任务设置
//

import SwiftUI
import AVKit
import UIKit

// MARK: - 主界面

struct ContentView: View {
    @EnvironmentObject var dm: DownloadManager

    @State private var selection = Set<UUID>()
    @State private var editMode: EditMode = .inactive
    @State private var filter = "全部"
    @State private var catFilter = "all"
    @State private var showNewTask = false
    @State private var showSettings = false
    @State private var showNewGroup = false
    @State private var newGroupName = ""
    @State private var showClearConfirm = false
    @State private var showMovePicker = false
    @State private var previewItem: DownloadItem?

    private var visibleItems: [DownloadItem] {
        var arr = dm.items
        if filter != "全部" { arr = arr.filter { $0.group == filter } }
        if catFilter != "all" { arr = arr.filter { $0.kind == catFilter } }
        return arr
    }

    var body: some View {
        NavigationStack {
            Group {
                if dm.items.isEmpty {
                    emptyState
                } else {
                    taskList
                }
            }
            .navigationTitle("我的任务")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbarContent }
            .environment(\.editMode, $editMode)
            .safeAreaInset(edge: .bottom) {
                if editMode == .active && !selection.isEmpty { batchBar }
            }
            .sheet(isPresented: $showNewTask) { NewTaskView() }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .sheet(item: $previewItem) { item in
                if let p = item.localPath {
                    VideoPreview(url: URL(fileURLWithPath: p), title: item.name)
                }
            }
            .alert("新建分组", isPresented: $showNewGroup) {
                TextField("分组名称", text: $newGroupName)
                Button("取消", role: .cancel) { newGroupName = "" }
                Button("创建") {
                    dm.addGroup(newGroupName)
                    newGroupName = ""
                }
            }
            .confirmationDialog("一键清理", isPresented: $showClearConfirm, titleVisibility: .visible) {
                Button("只清记录（保留文件）") { dm.clearFinished(deleteFiles: false) }
                Button("清记录并删除文件", role: .destructive) { dm.clearFinished(deleteFiles: true) }
                Button("取消", role: .cancel) {}
            } message: {
                Text("已完成和失败的任务会被移除")
            }
            .confirmationDialog("移动到分组", isPresented: $showMovePicker, titleVisibility: .visible) {
                ForEach(dm.groups, id: \.self) { g in
                    Button(g) {
                        dm.move(Array(selection), to: g)
                        exitEdit()
                    }
                }
                Button("取消", role: .cancel) {}
            }
            .overlay(alignment: .bottom) { toastView }
        }
    }

    // MARK: 列表

    private var taskList: some View {
        List(selection: $selection) {
            Section {
                ForEach(visibleItems) { item in
                    TaskRow(item: item, onPreview: { previewItem = item })
                        .tag(item.id)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button(role: .destructive) {
                                dm.delete([item.id])
                            } label: { Label("删除", systemImage: "trash") }

                            if item.state == .downloading || item.state == .queued {
                                Button { dm.pause(item.id) } label: {
                                    Label("暂停", systemImage: "pause.fill")
                                }.tint(.orange)
                            } else if item.state == .paused || item.state == .failed {
                                Button { dm.resume(item.id) } label: {
                                    Label("继续", systemImage: "play.fill")
                                }.tint(.green)
                            }
                        }
                }
            } header: {
                HStack {
                    Menu {
                        Button("全部") { filter = "全部" }
                        ForEach(dm.groups, id: \.self) { g in
                            Button(g) { filter = g }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.down")
                                .font(.caption2)
                            Text(filter)
                            Text("(\(visibleItems.count))")
                                .foregroundStyle(.secondary)
                        }
                        .font(.subheadline.weight(.semibold))
                    }
                    Spacer()
                    Menu {
                        Button("全部类型") { catFilter = "all" }
                        Button("视频") { catFilter = "video" }
                        Button("图片") { catFilter = "image" }
                        Button("音频") { catFilter = "audio" }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: iconForCat)
                                .font(.caption2)
                            Text(labelForCat)
                        }
                        .font(.subheadline.weight(.semibold))
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { dm.restoreTasks() }
    }

    private var labelForCat: String {
        switch catFilter {
        case "video": return "视频"
        case "image": return "图片"
        case "audio": return "音频"
        default: return "全部类型"
        }
    }

    private var iconForCat: String {
        switch catFilter {
        case "video": return "film"
        case "image": return "photo"
        case "audio": return "music.note"
        default: return "chevron.down"
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "arrow.down.circle")
                .font(.system(size: 54))
                .foregroundStyle(.tertiary)
            Text("还没有下载任务")
                .font(.headline)
            Text("在 Safari 里用「视频嗅探」扩展找到视频，\n点「下载」就会自动跳到这里。")
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button {
                showNewTask = true
            } label: {
                Label("新建任务", systemImage: "plus")
            }
            .buttonStyle(.borderedProminent)
            .padding(.top, 6)
        }
        .padding()
    }

    // MARK: 工具栏

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .navigationBarLeading) {
            Button {
                showNewTask = true
            } label: {
                Image(systemName: "plus")
            }
            .accessibilityLabel("新建任务")
        }

        ToolbarItem(placement: .navigationBarTrailing) {
            Menu {
                Button { showNewGroup = true } label: { Label("新建分组", systemImage: "folder.badge.plus") }
                Button { showNewTask = true } label: { Label("新建任务", systemImage: "plus.square") }

                Divider()

                Button { dm.startAll() } label: { Label("全部开始", systemImage: "play.fill") }
                Button { dm.pauseAll() } label: { Label("全部暂停", systemImage: "pause.fill") }

                Divider()

                Button(role: .destructive) { showClearConfirm = true } label: {
                    Label("一键清理", systemImage: "trash")
                }

                Divider()

                Button { showSettings = true } label: { Label("任务设置", systemImage: "gearshape") }
                Button {
                    withAnimation { editMode = (editMode == .active ? .inactive : .active) }
                    if editMode == .inactive { selection.removeAll() }
                } label: {
                    Label(editMode == .active ? "结束选择" : "批量操作",
                          systemImage: editMode == .active ? "checkmark.circle" : "checklist")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .accessibilityLabel("更多")
        }
    }

    // MARK: 批量操作条

    private var batchBar: some View {
        HStack(spacing: 0) {
            batchButton("导出", "square.and.arrow.down") {
                dm.saveToPhotos(Array(selection))
                exitEdit()
            }
            batchButton("移动", "folder") { showMovePicker = true }
            batchButton("删除", "trash", destructive: true) {
                dm.delete(Array(selection))
                exitEdit()
            }
        }
        .padding(.vertical, 8)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
    }

    private func batchButton(_ title: String, _ icon: String,
                             destructive: Bool = false,
                             action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: icon).font(.system(size: 17))
                Text(title).font(.caption2)
            }
            .frame(maxWidth: .infinity)
            .foregroundStyle(destructive ? Color.red : Color.accentColor)
        }
        .buttonStyle(.plain)
    }

    private func exitEdit() {
        withAnimation { editMode = .inactive }
        selection.removeAll()
    }

    // MARK: Toast

    @ViewBuilder
    private var toastView: some View {
        if let msg = dm.toast {
            Text(msg)
                .font(.footnote)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(.ultraThinMaterial, in: Capsule())
                .padding(.bottom, 24)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task {
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    withAnimation { dm.toast = nil }
                }
        }
    }
}

// MARK: - 单行

struct TaskRow: View {
    @EnvironmentObject var dm: DownloadManager
    let item: DownloadItem
    var onPreview: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundStyle(tint)
                    .frame(width: 24)
                    .padding(.top, 2)

                VStack(alignment: .leading, spacing: 3) {
                    Text(item.name)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(2)

                    HStack(spacing: 6) {
                        Text(item.state.label)
                            .foregroundStyle(tint)
                        Text("·")
                        Text(subtitle)
                        if item.savedToPhotos {
                            Text("·")
                            Label("相册", systemImage: "photo")
                                .labelStyle(.titleAndIcon)
                                .foregroundStyle(.green)
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                }

                Spacer(minLength: 4)

                actionButton
            }

            if item.state == .downloading {
                ProgressView(value: item.progress)
                    .tint(.accentColor)
            }

            if let err = item.error, item.state == .failed {
                Text(err)
                    .font(.caption2)
                    .foregroundStyle(.red)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .onTapGesture {
            if item.state == .done, item.localPath != nil { onPreview() }
        }
        .contextMenu { longPressMenu }
    }

    /// 长按任务弹出的菜单，和常见下载器保持一致
    @ViewBuilder
    private var longPressMenu: some View {
        Menu {
            ForEach(dm.groups, id: \.self) { g in
                Button {
                    dm.move([item.id], to: g)
                } label: {
                    if g == item.group {
                        Label(g, systemImage: "checkmark")
                    } else {
                        Text(g)
                    }
                }
            }
        } label: {
            Label("移动到分组", systemImage: "folder")
        }

        if let p = item.pageURL, let u = URL(string: p) {
            Button {
                UIApplication.shared.open(u)
            } label: {
                Label("打开网页地址", systemImage: "safari")
            }

            Button {
                UIPasteboard.general.string = p
                dm.toast = "已复制网页链接"
            } label: {
                Label("复制网页链接", systemImage: "doc.on.doc")
            }
        }

        Button {
            UIPasteboard.general.string = item.url
            dm.toast = "已复制视频链接"
        } label: {
            Label("复制视频链接", systemImage: "link")
        }

        if item.state == .done {
            Button {
                dm.saveToPhotos([item.id])
            } label: {
                Label("导出到相册", systemImage: "square.and.arrow.down")
            }
        }

        if item.state == .paused || item.state == .failed {
            Button {
                dm.resume(item.id)
            } label: {
                Label("继续下载", systemImage: "play.fill")
            }
        }

        Button(role: .destructive) {
            dm.delete([item.id])
        } label: {
            Label("删除", systemImage: "trash")
        }
    }

    private var subtitle: String {
        var parts: [String] = []
        if item.state == .downloading && item.totalBytes > 0 {
            parts.append("\(Int(item.progress * 100))%")
        }
        parts.append(item.displaySize)
        if item.isHLS { parts.append("HLS") }
        return parts.joined(separator: " · ")
    }

    private var icon: String {
        switch item.state {
        case .done: return "checkmark.circle.fill"
        case .failed: return "exclamationmark.triangle.fill"
        case .paused: return "pause.circle.fill"
        case .merging, .saving: return "gearshape.2.fill"
        default: return item.isHLS ? "film.stack" : "film"
        }
    }

    private var tint: Color {
        switch item.state {
        case .done: return .green
        case .failed: return .red
        case .paused: return .orange
        case .merging, .saving: return .purple
        default: return .accentColor
        }
    }

    @ViewBuilder
    private var actionButton: some View {
        switch item.state {
        case .downloading, .queued:
            Button { dm.pause(item.id) } label: {
                Image(systemName: "pause.circle").font(.title3)
            }.buttonStyle(.plain)
        case .paused:
            Button { dm.resume(item.id) } label: {
                Image(systemName: "play.circle").font(.title3)
            }.buttonStyle(.plain)
        case .failed:
            Button { dm.retry(item.id) } label: {
                Image(systemName: "arrow.clockwise.circle").font(.title3)
            }.buttonStyle(.plain)
        case .done:
            Button { dm.saveToPhotos([item.id]) } label: {
                Image(systemName: item.savedToPhotos ? "photo.badge.checkmark" : "square.and.arrow.down")
                    .font(.title3)
            }.buttonStyle(.plain)
        default:
            ProgressView().controlSize(.small)
        }
    }
}

// MARK: - 新建任务

struct NewTaskView: View {
    @EnvironmentObject var dm: DownloadManager
    @Environment(\.dismiss) private var dismiss

    @State private var url = ""
    @State private var name = ""
    @State private var group = "默认分组"

    var body: some View {
        NavigationStack {
            Form {
                Section("视频地址") {
                    TextField("https://… 或 .m3u8", text: $url, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .lineLimit(2...4)

                    Button {
                        if let s = UIPasteboard.general.string, !s.isEmpty {
                            url = s.trimmingCharacters(in: .whitespacesAndNewlines)
                        } else {
                            dm.toast = "剪贴板里没有文字"
                        }
                    } label: {
                        Label("从剪贴板粘贴", systemImage: "doc.on.clipboard")
                    }
                }

                Section("名称（可留空）") {
                    TextField("自动根据地址生成", text: $name)
                }

                Section("分组") {
                    Picker("分组", selection: $group) {
                        ForEach(dm.groups, id: \.self) { Text($0).tag($0) }
                    }
                }

                Section {
                    Text("支持 http/https 直链和 .m3u8 分片流。分片流会用系统播放器下载并导出成 mp4，体积较大时请保持 App 在前台。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("新建任务")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("开始") {
                        dm.addDownload(urlString: url,
                                       name: name.isEmpty ? nil : name,
                                       group: group)
                        dismiss()
                    }
                    .disabled(url.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                if group.isEmpty { group = dm.groups.first ?? "默认分组" }
            }
        }
    }
}

// MARK: - 任务设置

struct SettingsView: View {
    @EnvironmentObject var dm: DownloadManager
    @Environment(\.dismiss) private var dismiss
    @State private var diag: DiagResult?

    var body: some View {
        NavigationStack {
            Form {
                Section("下载") {
                    Toggle("仅 Wi-Fi 下载", isOn: Binding(
                        get: { dm.settings.wifiOnly },
                        set: { dm.settings.wifiOnly = $0; dm.settingsChanged() }
                    ))

                    Picker("同时下载数", selection: Binding(
                        get: { dm.settings.maxConcurrent },
                        set: { dm.settings.maxConcurrent = $0; dm.settingsChanged() }
                    )) {
                        Text("1").tag(1)
                        Text("2").tag(2)
                        Text("3").tag(3)
                        Text("4").tag(4)
                    }
                }

                Section("相册") {
                    Toggle("下载完成自动存相册", isOn: Binding(
                        get: { dm.settings.autoSaveToPhotos },
                        set: { dm.settings.autoSaveToPhotos = $0; dm.settingsChanged() }
                    ))
                    Text("关闭时，可以在任务上点右下角图标，或用「批量操作 → 导出」手动存。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("关于") {
                    LabeledContent("版本", value: "1.0.0")
                    LabeledContent("扩展", value: "Safari 视频嗅探")
                    Text("在 Safari 里打开视频页，点右下角悬浮球，选「下载」即可把任务发到这里。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("环境自检") {
                    if let d = diag {
                        LabeledContent("Documents 可写", value: d.documentsWritable ? "✅ 是" : "❌ 否")
                        LabeledContent("媒体目录", value: d.mediaWritable ? "✅ 可写" : "❌ 不可写")
                        LabeledContent("系统临时目录", value: d.tmpWritable ? "✅ 可写" : "❌ 不可写")
                        Text(d.container)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    } else {
                        Text("检测中…").font(.caption).foregroundStyle(.secondary)
                    }
                    Text("下载失败时把这一节截图发我，能直接定位是容器不可写还是网络被拒。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("任务设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
            .onAppear { diag = dm.diagnose() }
        }
    }
}

// MARK: - 播放

struct VideoPreview: View {
    let url: URL
    let title: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VideoPlayer(player: AVPlayer(url: url))
                .ignoresSafeArea()
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("完成") { dismiss() }
                    }
                }
        }
    }
}
