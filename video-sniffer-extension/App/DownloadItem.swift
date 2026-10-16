//
//  DownloadItem.swift
//  下载任务的数据模型
//

import Foundation

enum DownloadState: String, Codable {
    case queued        // 排队中
    case downloading   // 下载中
    case paused        // 已暂停
    case merging       // 合并 / 导出中（HLS）
    case saving        // 存相册中
    case done          // 完成
    case failed        // 失败

    var label: String {
        switch self {
        case .queued: return "排队中"
        case .downloading: return "下载中"
        case .paused: return "已暂停"
        case .merging: return "合并中"
        case .saving: return "存相册"
        case .done: return "已完成"
        case .failed: return "失败"
        }
    }
}

struct DownloadItem: Identifiable, Codable, Equatable {
    var id: UUID = UUID()
    var url: String
    var name: String
    var state: DownloadState = .queued
    var receivedBytes: Int64 = 0
    var totalBytes: Int64 = 0
    var localPath: String?
    var error: String?
    var isHLS: Bool = false
    var savedToPhotos: Bool = false
    var createdAt: Date = Date()

    /// HLS 下载由 AVFoundation 驱动，进度是按时间轴算的，单独存
    var hlsProgress: Double = 0

    /// 归属分组，对应界面上的「移动」
    var group: String = "默认分组"

    /// 0...1，总大小未知时返回 0
    var progress: Double {
        if isHLS && totalBytes == 0 { return min(1, max(0, hlsProgress)) }
        guard totalBytes > 0 else { return 0 }
        return min(1, Double(receivedBytes) / Double(totalBytes))
    }

    var displaySize: String {
        if totalBytes > 0 { return ByteCountFormatter.string(fromByteCount: totalBytes, countStyle: .file) }
        if receivedBytes > 0 { return ByteCountFormatter.string(fromByteCount: receivedBytes, countStyle: .file) }
        return "未知大小"
    }

    var isActive: Bool {
        state == .downloading || state == .queued || state == .merging || state == .saving
    }

    /// 文件名清洗：iOS 不允许 / 和 : 等字符
    static func safeName(_ raw: String, fallbackExt: String = "mp4") -> String {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { s = "video-\(Int(Date().timeIntervalSince1970))" }
        let bad = CharacterSet(charactersIn: "/\\:*?\"<>|\n\r\t")
        s = s.components(separatedBy: bad).joined(separator: "_")
        if s.count > 80 { s = String(s.prefix(80)) }
        if !s.lowercased().hasSuffix("." + fallbackExt) && !s.lowercased().hasSuffix(".mov") {
            s += "." + fallbackExt
        }
        return s
    }
}
