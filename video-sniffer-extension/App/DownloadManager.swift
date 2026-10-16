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

struct AppSettings: Codable, Equatable {
    var autoSaveToPhotos = false      // 下载完成自动存相册
    var wifiOnly = true               // 仅 Wi-Fi 下载
    var maxConcurrent = 2             // 同时下载数
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
    private let hlsID = "com.vsd.VideoSniffer.hls"
    private let fm = FileManager.default

    private(set) var mediaDir: URL
    private let storeURL: URL

    private var bgSession: URLSession!
    private var hlsSession: AVAssetDownloadURLSession!

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
        bgConfig.allowsCellularAccess = !settings.wifiOnly
        bgSession = URLSession(configuration: bgConfig, delegate: self, delegateQueue: .main)

        let hlsConfig = URLSessionConfiguration.background(withIdentifier: hlsID)
        hlsConfig.isDiscretionary = false
        hlsConfig.sessionSendsLaunchEvents = true
        hlsConfig.allowsCellularAccess = !settings.wifiOnly
        hlsSession = AVAssetDownloadURLSession(configuration: hlsConfig, assetDownloadDelegate: self, delegateQueue: .main)
    }

    // MARK: - 持久化

    private func load() {
        guard let data = try? Data(contentsOf: storeURL),
              let s = try? JSONDecoder().decode(Store.self, from: data) else { return }
        items = s.items
        groups = s.groups.isEmpty ? ["默认分组"] : s.groups
        settings = s.settings
        // 上次退出时还在下载的都标成已暂停，等用户点继续
        for i in items.indices where items[i].isActive {
            items[i].state = .paused
        }
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
        hlsSession.getAllTasks { [weak self] tasks in
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

    func addDownload(urlString: String, name: String? = nil, group: String? = nil) {
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
        let active = items.filter { $0.state == .downloading }.count
        let room = max(0, settings.maxConcurrent - active)
        guard room > 0 else { return }
        let waiting = items.filter { $0.state == .queued }.suffix(room)
        for it in waiting { start(it) }
    }

    private func start(_ it: DownloadItem) {
        if it.isHLS { startHLS(it) } else { startProgressive(it) }
    }

    private func startProgressive(_ it: DownloadItem) {
        guard let url = URL(string: it.url) else { return }

        // 有断点数据就续传
        let resumeFile = mediaDir.appendingPathComponent("resume-\(it.id.uuidString).dat")
        let task: URLSessionDownloadTask
        if let data = try? Data(contentsOf: resumeFile), !data.isEmpty {
            task = bgSession.downloadTask(withResumeData: data)
            try? fm.removeItem(at: resumeFile)
        } else {
            task = bgSession.downloadTask(with: url)
        }
        task.taskDescription = it.id.uuidString
        update(it.id) { $0.state = .downloading; $0.error = nil }
        task.resume()
    }

    private func startHLS(_ it: DownloadItem) {
        guard let url = URL(string: it.url) else { return }
        let asset = AVURLAsset(url: url)
        let options: [String: Any] = [
            AVAssetDownloadTaskMinimumRequiredMediaBitrateKey: 800_000
        ]
        guard let task = hlsSession.makeAssetDownloadTask(
            asset: asset,
            assetTitle: it.name,
            assetArtworkData: nil,
            options: options
        ) else {
            update(it.id) { $0.state = .failed; $0.error = "无法创建 HLS 下载任务" }
            return
        }
        task.taskDescription = it.id.uuidString
        update(it.id) { $0.state = .downloading; $0.error = nil; $0.hlsProgress = 0 }
        task.resume()
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

        hlsSession.getAllTasks { [weak self] tasks in
            guard let self else { return }
            if let t = tasks.first(where: { $0.taskDescription == id.uuidString }) {
                t.cancel()
                self.update(id) { $0.state = .paused }
            } else if it.isHLS {
                self.update(id) { $0.state = .paused }
            }
        }
    }

    func resume(_ id: UUID) {
        update(id) { $0.state = .queued; $0.error = nil }
        pump()
    }

    func retry(_ id: UUID) {
        update(id) { $0.state = .queued; $0.error = nil; $0.receivedBytes = 0; $0.hlsProgress = 0 }
        pump()
    }

    func cancel(_ id: UUID) {
        let idStr = id.uuidString
        bgSession.getAllTasks { tasks in
            tasks.first { $0.taskDescription == idStr }?.cancel()
        }
        hlsSession.getAllTasks { tasks in
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

    // MARK: - HLS 导出

    private func exportHLS(id: UUID, location: URL) {
        guard let it = item(id) else { return }
        let outURL = mediaDir.appendingPathComponent(DownloadItem.safeName(it.name, fallbackExt: "mp4"))
        if fm.fileExists(atPath: outURL.path) { try? fm.removeItem(at: outURL) }

        update(id) { $0.state = .merging }

        let asset = AVURLAsset(url: location)
        runExport(asset: asset, preset: AVAssetExportPresetPassthrough, to: outURL) { [weak self] ok, err in
            guard let self else { return }
            if ok {
                self.finishFile(id: id, url: outURL)
                return
            }
            // 直通导出常对 TS 分片失败，回退成重新编码
            self.runExport(asset: AVURLAsset(url: location), preset: AVAssetExportPresetHighestQuality, to: outURL) { ok2, err2 in
                if ok2 {
                    self.finishFile(id: id, url: outURL)
                } else {
                    self.update(id) {
                        $0.state = .failed
                        $0.error = "导出失败：" + (err2 ?? err ?? "未知原因")
                    }
                    self.pump()
                }
            }
        }
    }

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
        let files = ids.compactMap { id -> (UUID, URL)? in
            guard let it = item(id), let p = it.localPath else { return nil }
            return (id, URL(fileURLWithPath: p))
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
                for (id, url) in files {
                    PHPhotoLibrary.shared().performChanges {
                        let req = PHAssetCreationRequest.forAsset()
                        let opts = PHAssetResourceCreationOptions()
                        opts.originalFilename = url.lastPathComponent
                        req.addResource(with: .video, fileURL: url, options: opts)
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
        addDownload(urlString: raw, name: name)
        say("已加入下载队列")
    }

    func settingsChanged() {
        save()
        let cellular = !settings.wifiOnly
        bgSession.configuration.allowsCellularAccess = cellular
        hlsSession.configuration.allowsCellularAccess = cellular
        pump()
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

// MARK: - HLS 下载

extension DownloadManager: AVAssetDownloadDelegate {

    func urlSession(_ session: URLSession, assetDownloadTask: AVAssetDownloadTask,
                    didLoad timeRange: CMTimeRange, totalTimeRangesLoaded loadedTimeRanges: [NSValue],
                    timeRangeExpectedToLoad: CMTimeRange) {
        guard let idStr = assetDownloadTask.taskDescription, let id = UUID(uuidString: idStr) else { return }
        let expected = CMTimeGetSeconds(timeRangeExpectedToLoad.duration)
        guard expected > 0 else { return }
        var done = 0.0
        for v in loadedTimeRanges {
            done += CMTimeGetSeconds(v.timeRangeValue.duration)
        }
        update(id) { it in
            it.state = .downloading
            it.hlsProgress = min(1, done / expected)
        }
    }

    func urlSession(_ session: URLSession, assetDownloadTask: AVAssetDownloadTask,
                    didFinishDownloadingTo location: URL) {
        guard let idStr = assetDownloadTask.taskDescription, let id = UUID(uuidString: idStr) else { return }
        exportHLS(id: id, location: location)
    }
}

// MARK: - 通用任务回调（普通下载 + HLS 共用）
// 注意：不要在这里再写 `: URLSessionTaskDelegate`。
// DownloadManager 已经通过 URLSessionDownloadDelegate 继承了它，
// 再声明一次会触发 "redundant conformance" 编译错误。

extension DownloadManager {

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error, let idStr = task.taskDescription, let id = UUID(uuidString: idStr) else { return }

        // 暂停产生的取消不算失败
        let ns = error as NSError
        if ns.code == NSURLErrorCancelled { return }

        update(id) {
            $0.state = .failed
            $0.error = error.localizedDescription
        }
        pump()
    }
}
