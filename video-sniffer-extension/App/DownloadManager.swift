//
//  DownloadManager.swift
//  下载引擎：后台下载、HLS、进度、持久化、导出到相册
//
//  线程约定：两个 URLSession 的 delegateQueue 都设为 OperationQueue.main，
//  因此所有回调都在主线程，可以直接改 @Published 属性，不需要到处 dispatch。
//

import Foundation
import AVFoundation
import Photos
import UIKit
import Network

struct AppSettings: Codable, Equatable {
    var autoSaveToPhotos = false
    /// 默认允许蜂窝网络。
    /// 之前默认 true，并把它映射成 URLSession 的 allowsCellularAccess=false，
    /// 结果在蜂窝网络下直接报 -1009「已断开与互联网的连接」，用户以为是没权限。
    var wifiOnly = false
    var maxConcurrent = 2
    /// 用于迁移老版本里被误设成 true 的 wifiOnly
    var settingsVersion: Int?
}

/// 环境自检结果：万一还是下不来，靠这个定位是「容器不可写」还是「网络被拒」
struct DiagResult {
    var container = ""
    var documentsWritable = false
    var tmpWritable = false
    var mediaDirExists = false
    var mediaWritable = false
}

private struct Store: Codable {
    var items: [DownloadItem] = []
    var groups: [String] = ["默认分组"]
    var settings = AppSettings()
}

final class DownloadManager: NSObject, ObservableObject {

    static let shared = DownloadManager()

    static let urlScheme = "videosniffer"

    @Published var items: [DownloadItem] = []
    @Published var groups: [String] = ["默认分组"]
    @Published var settings = AppSettings()
    @Published var toast: String?

    private let bgID = "com.vsd.VideoSniffer.bg"
    private let fm = FileManager.default

    private(set) var mediaDir: URL
    private let storeURL: URL

    private var bgSession: URLSession!
    /// 后台会话写临时文件失败时（锁屏/切后台最容易触发），用它兜底重下
    private var fgSession: URLSession!

    /// 已经走过一次兜底的，不要无限重试
    private var usedFallback = Set<UUID>()
    private var bgAssertions: [UUID: UIBackgroundTaskIdentifier] = [:]
    /// 流式下载（不经过系统临时文件）的任务句柄
    private var streamTasks: [UUID: Task<Void, Never>] = [:]
    /// 自己实现的 HLS 下载器（不再用 AVAssetDownloadTask）
    private var hlsDownloaders: [UUID: HlsDownloader] = [:]

    private let pathMonitor = NWPathMonitor()
    private var isCellular = false

    var backgroundCompletionHandler: (() -> Void)?

    // MARK: - 初始化

    private override init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        mediaDir = docs.appendingPathComponent("Media", isDirectory: true)
        storeURL = docs.appendingPathComponent("downloads.json")
        super.init()

        try? FileManager.default.createDirectory(at: mediaDir, withIntermediateDirectories: true)
        load()

        let bgConfig = URLSessionConfiguration.background(withIdentifier: bgID)
        bgConfig.isDiscretionary = false
        bgConfig.sessionSendsLaunchEvents = true
        bgConfig.allowsCellularAccess = true      // 永远允许；仅 Wi-Fi 由代码在启动任务前判断
        bgSession = URLSession(configuration: bgConfig, delegate: self, delegateQueue: .main)

        // 前台会话：默认配置，写的是 App 自己的目录，不受 nsurlsessiond 限制
        let fgConfig = URLSessionConfiguration.default
        fgConfig.allowsCellularAccess = true
        fgConfig.timeoutIntervalForResource = 60 * 60 * 12
        fgSession = URLSession(configuration: fgConfig, delegate: self, delegateQueue: .main)

        // 监听网络类型，让「仅 Wi-Fi」开关能立刻生效
        pathMonitor.pathUpdateHandler = { [weak self] path in
            let cellular = path.usesInterfaceType(.cellular)
            DispatchQueue.main.async {
                guard let self else { return }
                if self.isCellular != cellular {
                    self.isCellular = cellular
                    self.pump()
                }
            }
        }
        pathMonitor.start(queue: DispatchQueue(label: "com.vsd.pathmonitor"))
    }

    // MARK: - 持久化

    private func load() {
        guard let data = try? Data(contentsOf: storeURL),
              let s = try? JSONDecoder().decode(Store.self, from: data) else { return }
        items = s.items
        groups = s.groups.isEmpty ? ["默认分组"] : s.groups
        settings = s.settings
        // 老版本默认「仅 Wi-Fi」并且在会话层禁用了蜂窝，
        // 结果在蜂窝网络下直接 -1009。这里强制迁回允许蜂窝。
        if (settings.settingsVersion ?? 0) < 1 {
            settings.wifiOnly = false
            settings.settingsVersion = 1
        }
        // 上次退出时还在下载的都标成已暂停，等用户点继续
        for i in items.indices where items[i].isActive {
            items[i].state = .paused
        }
        save()
    }

    private func save() {
        let s = Store(items: items, groups: groups, settings: settings)
        if let data = try? JSONEncoder().encode(s) {
            try? data.write(to: storeURL, options: .atomic)
        }
    }

    private func update(_ id: UUID, _ block: (inout DownloadItem) -> Void) {
        guard let idx = items.firstIndex(where: { $0.id == id }) else { return }
        block(&items[idx])
        save()
    }

    private func item(_ id: UUID) -> DownloadItem? {
        items.first { $0.id == id }
    }

    private func say(_ msg: String) {
        toast = msg
    }

    // MARK: - 启动 / 恢复

    /// App 冷启动时把系统里还活着的任务认回来
    func restoreTasks() {
        bgSession.getAllTasks { [weak self] tasks in
            guard let self else { return }
            for t in tasks {
                guard let idStr = t.taskDescription, let id = UUID(uuidString: idStr) else { continue }
                if self.items.contains(where: { $0.id == id }) {
                    self.update(id) { $0.state = .downloading }
                } else {
                    t.cancel()
                }
            }
        }
    }

    // MARK: - 添加任务

    func addDownload(urlString: String, name: String? = nil, group: String? = nil,
                     pageURL: String? = nil, kind: String? = nil) {
        let trimmed = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            say("地址无效")
            return
        }
        if items.contains(where: { $0.url == trimmed && ($0.isActive || $0.state == .queued) }) {
            say("这个地址已经在任务里了")
            return
        }

        let isHLS = url.pathExtension.lowercased() == "m3u8" || trimmed.lowercased().contains(".m3u8")
        var it = DownloadItem(url: trimmed, name: "")
        it.isHLS = isHLS
        it.group = group ?? groups.first ?? "默认分组"
        if let p = pageURL, !p.isEmpty { it.pageURL = p }
        if let k = kind, !k.isEmpty { it.kind = k }

        let baseName = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let fromURLCandidates = [
            url.deletingPathExtension().lastPathComponent,
            url.lastPathComponent
        ]
        var picked = baseName
        if picked.isEmpty {
            for c in fromURLCandidates where c.count > 2 && !looksGeneric(c) { picked = c; break }
        }
        if picked.isEmpty { picked = "video-\(items.count + 1)" }
        it.name = DownloadItem.safeName(picked, fallbackExt: isHLS ? "mp4" : (url.pathExtension.isEmpty ? "mp4" : url.pathExtension))

        items.insert(it, at: 0)
        save()
        pump()
    }

    private func looksGeneric(_ s: String) -> Bool {
        let lower = s.lowercased()
        if lower.count > 24 && lower.allSatisfy({ $0.isHexDigit }) { return true }   // 纯哈希文件名
        let generic: Set<String> = ["index", "playlist", "master", "hls", "media", "video",
                                    "vod", "out", "stream", "manifest", "chunk", "file", "main", "v"]
        return generic.contains(lower)
    }

    func addFromClipboard() {
        guard let s = UIPasteboard.general.string, !s.isEmpty else {
            say("剪贴板里没有文字")
            return
        }
        // 从一段文本里抠出第一个 http 链接
        var found: String?
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        detector?.enumerateMatches(in: s, options: [], range: NSRange(s.startIndex..., in: s)) { m, _, _ in
            if let m, let r = Range(m.range, in: s) {
                let candidate = String(s[r])
                if candidate.lowercased().hasPrefix("http") { found = candidate }
            }
        }
        if let f = found {
            addDownload(urlString: f)
        } else if s.lowercased().hasPrefix("http") {
            addDownload(urlString: s)
        } else {
            say("剪贴板里没有找到链接")
        }
    }

    // MARK: - 调度

    /// 控制并发：把 queued 的任务按顺序放出去
    func pump() {
        // 「仅 Wi-Fi」在代码里判断，而不是靠 URLSession 的 allowsCellularAccess
        // （那个在会话创建后就改不动了，会出现开关失灵 / 蜂窝下直接 -1009）
        if settings.wifiOnly && isCellular {
            var changed = false
            for i in items.indices where items[i].state == .queued {
                items[i].state = .paused
                items[i].error = "仅 Wi-Fi 模式：当前是蜂窝网络，已暂停"
                changed = true
            }
            if changed { save() }
            return
        }

        let active = items.filter { $0.state == .downloading }.count
        let room = max(0, settings.maxConcurrent - active)
        guard room > 0 else { return }
        let waiting = items.filter { $0.state == .queued }.suffix(room)
        for it in waiting { start(it) }
    }

    private func start(_ it: DownloadItem) {
        if it.isHLS { startHLS(it) } else { startProgressive(it, useForeground: false) }
    }

    private func startProgressive(_ it: DownloadItem, useForeground: Bool) {
        guard let url = URL(string: it.url) else { return }
        let session: URLSession = useForeground ? fgSession : bgSession

        // 有断点数据就续传。注意：失败重试时不复用，避免坏数据反复失败。
        let resumeFile = mediaDir.appendingPathComponent("resume-\(it.id.uuidString).dat")
        let task: URLSessionDownloadTask
        if !useForeground, usedFallback.contains(it.id) == false,
           let data = try? Data(contentsOf: resumeFile), !data.isEmpty {
            task = session.downloadTask(withResumeData: data)
            try? fm.removeItem(at: resumeFile)
        } else {
            task = session.downloadTask(with: url)
        }
        task.taskDescription = it.id.uuidString
        if useForeground { beginBGAssertion(it.id) }
        update(it.id) { $0.state = .downloading; $0.error = nil }
        task.resume()
    }

    /// 后台会话写临时文件失败（锁屏 / 切后台最容易触发）时的兜底：
    /// 改用「流式 dataTask + 自己写文件」，完全不依赖系统临时文件。
    private func startFallback(_ id: UUID) {
        guard let it = item(id), !it.isHLS else { return }
        say("系统下载通道被拒，改用流式通道")
        startStreamed(it)
    }

    /// 关键兜底：URLSessionDownloadTask 需要系统先在容器里建临时文件，
    /// 某些设备/签名环境下这一步会失败（NSURLErrorCannotCreateFile -3000）。
    /// dataTask 把字节直接交给 App，我们写进 Documents/Media，绕开整个临时文件机制。
    private func startStreamed(_ it: DownloadItem) {
        guard let url = URL(string: it.url) else { return }
        let id = it.id
        usedFallback.insert(id)
        beginBGAssertion(id)

        let dest = mediaDir.appendingPathComponent(DownloadItem.safeName(it.name, fallbackExt: "mp4"))
        try? fm.createDirectory(at: mediaDir, withIntermediateDirectories: true)
        if fm.fileExists(atPath: dest.path) { try? fm.removeItem(at: dest) }
        guard fm.createFile(atPath: dest.path, contents: nil),
              let handle = try? FileHandle(forWritingTo: dest) else {
            update(id) {
                $0.state = .failed
                $0.error = "无法创建目标文件：\(dest.path)"
            }
            endBGAssertion(id)
            pump()
            return
        }

        update(id) { $0.state = .downloading; $0.error = nil; $0.receivedBytes = 0 }

        var req = URLRequest(url: url)
        req.timeoutInterval = 60 * 30
        req.setValue("identity", forHTTPHeaderField: "Accept-Encoding")

        let task = Task { [weak self] in
            guard let self else { return }
            do {
                let (bytes, response) = try await self.fgSession.bytes(for: req)
                let expected = response.expectedContentLength
                await MainActor.run {
                    self.update(id) { if expected > 0 { $0.totalBytes = expected } }
                }

                var buffer = Data()
                buffer.reserveCapacity(1 << 16)
                var received: Int64 = 0

                for try await byte in bytes {
                    buffer.append(byte)
                    received += 1
                    if buffer.count >= (1 << 16) {
                        try handle.write(contentsOf: buffer)
                        buffer.removeAll(keepingCapacity: true)
                        let r = received, e = expected
                        await MainActor.run {
                            self.update(id) { $0.receivedBytes = r; if e > 0 { $0.totalBytes = e } }
                        }
                    }
                }
                if !buffer.isEmpty { try handle.write(contentsOf: buffer) }
                try handle.close()
                await MainActor.run {
                    self.streamTasks.removeValue(forKey: id)
                    self.finishFile(id: id, url: dest)
                }
            } catch {
                try? handle.close()
                try? self.fm.removeItem(at: dest)
                await MainActor.run {
                    self.streamTasks.removeValue(forKey: id)
                    let ns = error as NSError
                    self.update(id) {
                        $0.state = .failed
                        $0.error = "\(error.localizedDescription)  [\(ns.domain) \(ns.code)]"
                    }
                    self.endBGAssertion(id)
                    self.pump()
                }
            }
        }
        streamTasks[id] = task
    }

    private func beginBGAssertion(_ id: UUID) {
        guard bgAssertions[id] == nil else { return }
        var t: UIBackgroundTaskIdentifier = .invalid
        t = UIApplication.shared.beginBackgroundTask(withName: "vsd-\(id.uuidString)") { [weak self] in
            self?.endBGAssertion(id)
        }
        if t != .invalid { bgAssertions[id] = t }
    }

    private func endBGAssertion(_ id: UUID) {
        if let t = bgAssertions.removeValue(forKey: id), t != .invalid {
            UIApplication.shared.endBackgroundTask(t)
        }
    }

    /// HLS：用自己实现的下载器（解析 m3u8 → 逐段下载 → AES 解密 → 顺序合并）
    private func startHLS(_ it: DownloadItem) {
        guard let url = URL(string: it.url) else { return }
        let id = it.id
        usedFallback.insert(id)
        beginBGAssertion(id)

        let base = DownloadItem.safeName(it.name, fallbackExt: "mp4")
        let stem = (base as NSString).deletingPathExtension
        let merged = mediaDir.appendingPathComponent(stem + ".part")
        let workDir = mediaDir.appendingPathComponent("hls-\(id.uuidString)", isDirectory: true)

        let downloader = HlsDownloader(session: fgSession)
        hlsDownloaders[id] = downloader
        update(id) { $0.state = .downloading; $0.error = nil; $0.hlsProgress = 0 }

        Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await downloader.download(
                    playlistURL: url, destURL: merged, workDir: workDir
                ) { p, bytes in
                    DispatchQueue.main.async {
                        self.update(id) { $0.hlsProgress = p; $0.receivedBytes = bytes }
                    }
                }
                try? self.fm.removeItem(at: workDir)
                await MainActor.run {
                    self.finishHLS(id: id, merged: result.url, isFMP4: result.isFMP4, stem: stem)
                }
            } catch {
                try? self.fm.removeItem(at: workDir)
                await MainActor.run {
                    self.hlsDownloaders.removeValue(forKey: id)
                    let ns = error as NSError
                    self.update(id) {
                        $0.state = .failed
                        $0.error = "\(error.localizedDescription)  [\(ns.domain) \(ns.code)]"
                    }
                    self.endBGAssertion(id)
                    self.pump()
                }
            }
        }
    }

    /// 合并完成后的收尾：fMP4 本身就是 mp4；TS 先试着转 mp4，转不动就留 .ts
    private func finishHLS(id: UUID, merged: URL, isFMP4: Bool, stem: String) {
        hlsDownloaders.removeValue(forKey: id)

        let mp4 = mediaDir.appendingPathComponent(stem + ".mp4")

        if isFMP4 {
            try? fm.removeItem(at: mp4)
            if (try? fm.moveItem(at: merged, to: mp4)) != nil {
                finishFile(id: id, url: mp4)
            } else {
                update(id) { $0.state = .failed; $0.error = "合并文件写入失败" }
                endBGAssertion(id)
                pump()
            }
            return
        }

        update(id) { $0.state = .merging }
        try? fm.removeItem(at: mp4)

        runExport(asset: AVURLAsset(url: merged), preset: AVAssetExportPresetPassthrough, to: mp4) { [weak self] ok, _ in
            guard let self else { return }
            if ok, self.fm.fileExists(atPath: mp4.path) {
                try? self.fm.removeItem(at: merged)
                self.finishFile(id: id, url: mp4)
                return
            }
            self.runExport(asset: AVURLAsset(url: merged), preset: AVAssetExportPresetHighestQuality, to: mp4) { ok2, err2 in
                if ok2, self.fm.fileExists(atPath: mp4.path) {
                    try? self.fm.removeItem(at: merged)
                    self.finishFile(id: id, url: mp4)
                    return
                }
                // 转不了就保住 .ts —— VLC / nPlayer 都能播，总比什么都没有强
                try? self.fm.removeItem(at: mp4)
                let ts = self.mediaDir.appendingPathComponent(stem + ".ts")
                try? self.fm.removeItem(at: ts)
                if (try? self.fm.moveItem(at: merged, to: ts)) != nil {
                    let attrs = try? self.fm.attributesOfItem(atPath: ts.path)
                    let size = (attrs?[.size] as? Int64) ?? 0
                    self.update(id) {
                        $0.state = .done
                        $0.localPath = ts.path
                        $0.error = nil
                        $0.receivedBytes = size
                        $0.totalBytes = size
                    }
                    self.say("已存为 .ts（转 mp4 失败：\(err2 ?? "未知原因")）")
                } else {
                    self.update(id) { $0.state = .failed; $0.error = "保存合并文件失败" }
                }
                self.endBGAssertion(id)
                self.pump()
            }
        }
    }

    // MARK: - 控制

    func startAll() {
        for i in items.indices where items[i].state == .paused || items[i].state == .failed {
            items[i].state = .queued
            items[i].error = nil
        }
        save()
        pump()
    }

    func pauseAll() {
        for it in items where it.state == .downloading || it.state == .queued {
            pause(it.id)
        }
    }

    func pause(_ id: UUID) {
        guard let it = item(id) else { return }

        // 流式任务：直接取消，状态存成暂停（下次从头下）
        if let t = streamTasks.removeValue(forKey: id) {
            t.cancel()
            endBGAssertion(id)
            update(id) { $0.state = .paused }
            return
        }

        bgSession.getAllTasks { [weak self] tasks in
            guard let self else { return }
            guard let t = tasks.first(where: { $0.taskDescription == id.uuidString }) as? URLSessionDownloadTask else { return }
            t.cancel(byProducingResumeData: { data in
                DispatchQueue.main.async {
                    if let data {
                        let f = self.mediaDir.appendingPathComponent("resume-\(id.uuidString).dat")
                        try? data.write(to: f)
                    }
                    self.update(id) { $0.state = .paused }
                }
            })
        }

        // 自己实现的 HLS 下载器：直接取消，状态存成暂停
        if let d = hlsDownloaders.removeValue(forKey: id) {
            d.cancel()
            endBGAssertion(id)
            update(id) { $0.state = .paused }
        } else if it.isHLS {
            update(id) { $0.state = .paused }
        }
    }

    func resume(_ id: UUID) {
        usedFallback.remove(id)
        update(id) { $0.state = .queued; $0.error = nil }
        pump()
    }

    func retry(_ id: UUID) {
        usedFallback.remove(id)          // 允许重新尝试后台通道
        update(id) { $0.state = .queued; $0.error = nil; $0.receivedBytes = 0; $0.hlsProgress = 0 }
        pump()
    }

    func cancel(_ id: UUID) {
        endBGAssertion(id)
        if let t = streamTasks.removeValue(forKey: id) { t.cancel() }
        if let d = hlsDownloaders.removeValue(forKey: id) { d.cancel() }
        let idStr = id.uuidString
        bgSession.getAllTasks { tasks in
            tasks.first { $0.taskDescription == idStr }?.cancel()
        }
        fgSession.getAllTasks { tasks in
            tasks.first { $0.taskDescription == idStr }?.cancel()
        }
    }

    func delete(_ ids: [UUID]) {
        for id in ids {
            cancel(id)
            if let it = item(id), let p = it.localPath {
                try? fm.removeItem(at: URL(fileURLWithPath: p))
            }
            try? fm.removeItem(at: mediaDir.appendingPathComponent("resume-\(id.uuidString).dat"))
        }
        let set = Set(ids)
        items.removeAll { set.contains($0.id) }
        save()
        pump()
    }

    /// 一键清理：只清掉已完成/失败的记录（可选同时删文件）
    func clearFinished(deleteFiles: Bool) {
        let targets = items.filter { $0.state == .done || $0.state == .failed }
        if deleteFiles {
            for it in targets where it.localPath != nil {
                try? fm.removeItem(at: URL(fileURLWithPath: it.localPath!))
            }
        }
        items.removeAll { $0.state == .done || $0.state == .failed }
        save()
        pump()
        say(deleteFiles ? "已清理并删除文件" : "已清理记录")
    }

    func move(_ ids: [UUID], to group: String) {
        let set = Set(ids)
        for i in items.indices where set.contains(items[i].id) {
            items[i].group = group
        }
        save()
        say("已移动到「\(group)」")
    }

    func addGroup(_ name: String) {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty, !groups.contains(n) else { return }
        groups.append(n)
        save()
    }

    // MARK: - 完成处理

    private func moveToMedia(_ tmp: URL, name: String) throws -> URL {
        let dest = mediaDir.appendingPathComponent(DownloadItem.safeName(name))
        if fm.fileExists(atPath: dest.path) {
            try fm.removeItem(at: dest)
        }
        try fm.moveItem(at: tmp, to: dest)
        return dest
    }

    private func finishFile(id: UUID, url: URL) {
        endBGAssertion(id)
        let attrs = try? fm.attributesOfItem(atPath: url.path)
        let size = (attrs?[.size] as? Int64) ?? 0
        update(id) {
            $0.localPath = url.path
            $0.state = .done
            $0.error = nil
            $0.receivedBytes = size
            $0.totalBytes = size
            if $0.isHLS { $0.hlsProgress = 1 }
        }
        if settings.autoSaveToPhotos {
            saveToPhotos([id], silent: true)
        }
        pump()
    }

    // MARK: - 转封装（TS → mp4）

    private func runExport(asset: AVAsset, preset: String, to outURL: URL,
                           completion: @escaping (Bool, String?) -> Void) {
        guard let session = AVAssetExportSession(asset: asset, presetName: preset) else {
            completion(false, "无法创建导出会话")
            return
        }
        session.outputURL = outURL
        session.outputFileType = .mp4
        session.shouldOptimizeForNetworkUse = true
        session.exportAsynchronously {
            DispatchQueue.main.async {
                switch session.status {
                case .completed: completion(true, nil)
                case .cancelled: completion(false, "已取消")
                default: completion(false, session.error?.localizedDescription ?? "导出未完成")
                }
            }
        }
    }

    // MARK: - 相册

    func saveToPhotos(_ ids: [UUID], silent: Bool = false) {
        let files = ids.compactMap { id -> (UUID, URL, String)? in
            guard let it = item(id), let p = it.localPath else { return nil }
            return (id, URL(fileURLWithPath: p), it.kind)
        }
        guard !files.isEmpty else {
            if !silent { say("没有可导出的文件") }
            return
        }

        PHPhotoLibrary.requestAuthorization(for: .addOnly) { [weak self] status in
            DispatchQueue.main.async {
                guard let self else { return }
                guard status == .authorized || status == .limited else {
                    self.say("没有相册权限，请到「设置 → 隐私 → 照片」里打开")
                    return
                }
                var remaining = files.count
                var failed = 0
                for (id, url, kind) in files {
                    // 图片必须按 .photo 存，按 .video 存会失败
                    let resourceType: PHAssetResourceType = (kind == "image") ? .photo : .video
                    PHPhotoLibrary.shared().performChanges {
                        let req = PHAssetCreationRequest.forAsset()
                        let opts = PHAssetResourceCreationOptions()
                        opts.originalFilename = url.lastPathComponent
                        req.addResource(with: resourceType, fileURL: url, options: opts)
                    } completionHandler: { ok, _ in
                        DispatchQueue.main.async {
                            if ok { self.update(id) { $0.savedToPhotos = true } } else { failed += 1 }
                            remaining -= 1
                            if remaining == 0 {
                                if !silent || failed > 0 {
                                    self.say(failed == 0 ? "已存入相册" : "\(failed) 个没能存入相册")
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - URL Scheme（Safari 扩展唤起）

    func handleIncomingURL(_ url: URL) {
        guard url.scheme?.lowercased() == DownloadManager.urlScheme else { return }
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let q = comps?.queryItems ?? []
        guard let raw = q.first(where: { $0.name == "url" })?.value, !raw.isEmpty else { return }
        let name = q.first(where: { $0.name == "name" })?.value
        let page = q.first(where: { $0.name == "page" })?.value
        let kind = q.first(where: { $0.name == "kind" })?.value
        addDownload(urlString: raw, name: name, pageURL: page, kind: kind)
        say("已加入下载队列")
    }

    func settingsChanged() {
        save()
        // allowsCellularAccess 在会话创建后改不动，所以「仅 Wi-Fi」交给 pump() 判断
        pump()
    }

    // MARK: - 环境自检

    func diagnose() -> DiagResult {
        var d = DiagResult()
        d.container = NSHomeDirectory()
        let docs = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
        d.documentsWritable = testWrite(docs)
        d.tmpWritable = testWrite(URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true))
        d.mediaDirExists = fm.fileExists(atPath: mediaDir.path)
        try? fm.createDirectory(at: mediaDir, withIntermediateDirectories: true)
        d.mediaWritable = testWrite(mediaDir)
        return d
    }

    private func testWrite(_ dir: URL) -> Bool {
        let f = dir.appendingPathComponent(".vsd-write-test")
        do {
            try Data([0x6f, 0x6b]).write(to: f)
            try fm.removeItem(at: f)
            return true
        } catch {
            return false
        }
    }
}

// MARK: - 普通下载

extension DownloadManager: URLSessionDownloadDelegate {

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        guard let idStr = downloadTask.taskDescription, let id = UUID(uuidString: idStr) else { return }
        update(id) { it in
            it.state = .downloading
            it.receivedBytes = totalBytesWritten
            if totalBytesExpectedToWrite > 0 { it.totalBytes = totalBytesExpectedToWrite }
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        guard let idStr = downloadTask.taskDescription, let id = UUID(uuidString: idStr),
              let it = item(id) else { return }
        do {
            let dest = try moveToMedia(location, name: it.name)
            finishFile(id: id, url: dest)
        } catch {
            update(id) { $0.state = .failed; $0.error = "保存文件失败：\(error.localizedDescription)" }
            pump()
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async { [weak self] in
            self?.backgroundCompletionHandler?()
            self?.backgroundCompletionHandler = nil
        }
    }
}

// MARK: - 通用任务回调（普通下载 + HLS 共用）
// 注意：不要在这里再写 `: URLSessionTaskDelegate`。
// DownloadManager 已经通过 URLSessionDownloadDelegate 继承了它，
// 再声明一次会触发 "redundant conformance" 编译错误。

extension DownloadManager {

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error, let idStr = task.taskDescription, let id = UUID(uuidString: idStr) else { return }

        let ns = error as NSError
        if ns.code == NSURLErrorCancelled { return }

        // 后台通道任何失败，都换「流式 dataTask」再试一次——
        // 这条通道不碰系统临时文件，绕开 NSURLErrorCannotCreateFile(-3000)。
        if session === bgSession, !usedFallback.contains(id) {
            update(id) { $0.error = nil }
            startFallback(id)
            return
        }

        endBGAssertion(id)
        update(id) {
            $0.state = .failed
            $0.error = "\(error.localizedDescription)  [\(ns.domain) \(ns.code)]"
        }
        pump()
    }
}
