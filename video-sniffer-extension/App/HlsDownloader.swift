//
//  HlsDownloader.swift
//  自己实现的 HLS 下载器。
//
//  为什么不用 AVAssetDownloadTask：
//   它是给「离线播放」设计的，会把流包成自己的 .movpkg，对编码/容器挑食，
//    遇到不合口味的流直接返回 NSURLErrorUnknown(-1)，而且不给任何细节。
//  这条路自己解析 m3u8、自己下分片、自己解密、自己合并，行为完全可控。
//

import Foundation
import CommonCrypto

enum HlsError: LocalizedError {
    case http(Int)
    case emptyPlaylist
    case noSegments
    case badKey
    case decryptFailed
    case cancelled

    var errorDescription: String? {
        switch self {
        case .http(let c): return "播放列表返回 HTTP \(c)"
        case .emptyPlaylist: return "播放列表是空的"
        case .noSegments: return "播放列表里没有分片"
        case .badKey: return "取不到解密密钥"
        case .decryptFailed: return "分片解密失败"
        case .cancelled: return "已取消"
        }
    }
}

final class HlsDownloader {

    // MARK: 数据结构

    struct Key {
        var method: String
        var uri: URL?
        var iv: Data?
    }

    struct Segment {
        var url: URL
        var offset: Int64?
        var length: Int64?
        var key: Key?
        var sequence: Int
    }

    struct Playlist {
        var isMaster = false
        var variants: [(url: URL, bandwidth: Int)] = []
        var segments: [Segment] = []
        var duration: Double = 0
        var targetDuration: Double = 0
        var map: Segment?
        var encrypted = false
    }

    private let session: URLSession
    private let fm = FileManager.default
    private let concurrency = 4
    private(set) var isCancelled = false

    init(session: URLSession) { self.session = session }

    func cancel() { isCancelled = true }

    // MARK: 入口

    /// 下载整个 HLS 流并合并成一个文件。
    /// - Returns: 合并后的文件 URL，以及它是不是 fMP4（fMP4 合并出来就是能播的 mp4）
    func download(playlistURL: URL, destURL: URL, workDir: URL,
                  onProgress: @escaping (_ progress: Double, _ bytes: Int64) -> Void) async throws -> (url: URL, isFMP4: Bool) {

        try? fm.createDirectory(at: workDir, withIntermediateDirectories: true)

        // 1) 播放列表（主列表就挑码率最高的一路）
        var pl = try await loadPlaylist(playlistURL)

        if pl.isMaster {
            guard let best = pl.variants.sorted(by: { $0.bandwidth > $1.bandwidth }).first else {
                throw HlsError.emptyPlaylist
            }
            pl = try await loadPlaylist(best.url)
        }

        guard !pl.segments.isEmpty else { throw HlsError.noSegments }

        // 2) 先把密钥取回来（同一个 key URI 只取一次）
        var keyCache: [String: Data] = [:]
        if pl.encrypted {
            let uris = Set(pl.segments.compactMap { $0.key?.uri?.absoluteString })
            for u in uris {
                guard let url = URL(string: u) else { continue }
                keyCache[u] = try await fetchData(url)
            }
            if let m = pl.map?.key, let u = m.uri?.absoluteString, keyCache[u] == nil {
                keyCache[u] = try await fetchData(url: u)
            }
        }

        // 3) 估算总大小用于进度
        let estimatedTotal = Int64(pl.segments.count) * 400_000

        // 4) 输出文件
        if fm.fileExists(atPath: destURL.path) { try? fm.removeItem(at: destURL) }
        guard fm.createFile(atPath: destURL.path, contents: nil),
              let out = try? FileHandle(forWritingTo: destURL) else {
            throw HlsError.badKey
        }
        defer { try? out.close() }

        var written: Int64 = 0

        // fMP4 的初始化段必须写在最前面
        let isFMP4 = (pl.map != nil)
        if let map = pl.map {
            let data = try await fetchSegment(map, keys: keyCache)
            if !data.isEmpty {
                try out.write(contentsOf: data)
                written += Int64(data.count)
            }
        }

        // 5) 分批并发下载，按顺序落盘（内存占用限制在一批之内）
        var index = 0
        while index < pl.segments.count {
            if isCancelled { throw HlsError.cancelled }
            let end = min(index + concurrency, pl.segments.count)
            let batch = Array(pl.segments[index..<end])

            let results = try await withThrowingTaskGroup(of: (Int, Data).self) { group -> [(Int, Data)] in
                for (offset, seg) in batch.enumerated() {
                    group.addTask { [weak self] in
                        guard let self else { return (offset, Data()) }
                        let d = try await self.fetchSegment(seg, keys: keyCache)
                        return (offset, d)
                    }
                }
                var acc: [(Int, Data)] = []
                for try await r in group { acc.append(r) }
                return acc
            }

            for (_, data) in results.sorted(by: { $0.0 < $1.0 }) {
                if !data.isEmpty {
                    try out.write(contentsOf: data)
                    written += Int64(data.count)
                    let p = estimatedTotal > 0 ? min(0.99, Double(written) / Double(estimatedTotal)) : 0
                    onProgress(p, written)
                }
            }
            index = end
        }

        try out.synchronize()
        onProgress(1.0, written)
        return (destURL, isFMP4)
    }

    // MARK: 播放列表

    func loadPlaylist(_ url: URL) async throws -> Playlist {
        let text = try await fetchText(url)
        return parse(text, baseURL: url)
    }

    private func fetchText(_ url: URL) async throws -> String {
        var req = URLRequest(url: url)
        req.timeoutInterval = 30
        let (data, resp) = try await session.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw HlsError.http(http.statusCode)
        }
        if let s = String(data: data, encoding: .utf8) { return s }
        if let s = String(data: data, encoding: .isoLatin1) { return s }
        throw HlsError.emptyPlaylist
    }

    private func fetchData(_ url: URL) async throws -> Data {
        try await fetchData(url: url.absoluteString)
    }

    private func fetchData(url: String) async throws -> Data {
        guard let u = URL(string: url) else { throw HlsError.badKey }
        let (data, resp) = try await session.data(from: u)
        if let http = resp as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw HlsError.http(http.statusCode)
        }
        return data
    }

    // MARK: 取一个分片（含解密）

    private func fetchSegment(_ seg: Segment, keys: [String: Data]) async throws -> Data {
        var req = URLRequest(url: seg.url)
        req.timeoutInterval = 60
        if let off = seg.offset, let len = seg.length {
            req.setValue("bytes=\(off)-\(off + len - 1)", forHTTPHeaderField: "Range")
        }
        let (raw, resp) = try await session.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw HlsError.http(http.statusCode)
        }

        guard let key = seg.key, key.method.uppercased() == "AES-128",
              let uri = key.uri?.absoluteString, let keyData = keys[uri] else {
            return raw
        }

        let iv = key.iv ?? Self.sequenceIV(seg.sequence)
        guard let plain = Self.aesCBCDecrypt(raw, key: keyData, iv: iv) else {
            throw HlsError.decryptFailed
        }
        return plain
    }

    /// 没有 IV 属性时，IV 就是分片序号的大端 16 字节表示
    static func sequenceIV(_ seq: Int) -> Data {
        var iv = Data(repeating: 0, count: 16)
        var be = UInt32(truncatingIfNeeded: seq).bigEndian
        withUnsafeBytes(of: &be) { iv.replaceSubrange(12..<16, with: $0) }
        return iv
    }

    static func aesCBCDecrypt(_ data: Data, key: Data, iv: Data) -> Data? {
        guard !data.isEmpty, key.count == kCCKeySizeAES128, iv.count == kCCBlockSizeAES128 else { return nil }
        var out = Data(count: data.count + kCCBlockSizeAES128)
        var moved = 0
        let status: CCCryptorStatus = out.withUnsafeMutableBytes { outBuf in
            data.withUnsafeBytes { dataBuf in
                key.withUnsafeBytes { keyBuf in
                    iv.withUnsafeBytes { ivBuf in
                        CCCrypt(CCOperation(kCCDecrypt),
                                CCAlgorithm(kCCAlgorithmAES),
                                CCOptions(kCCOptionsPKCS7Padding),
                                keyBuf.baseAddress, key.count,
                                ivBuf.baseAddress,
                                dataBuf.baseAddress, data.count,
                                outBuf.baseAddress, out.count,
                                &moved)
                    }
                }
            }
        }
        guard status == kCCSuccess else { return nil }
        return out.prefix(moved)
    }

    // MARK: 解析 m3u8

    func parse(_ text: String, baseURL: URL) -> Playlist {
        var out = Playlist()
        var pendingVariantBW = 0
        var hasPendingVariant = false
        var lastDur: Double = 0
        var curKey: Key?
        var curMap: Segment?
        var pendingRange: (Int64?, Int64)?
        var rangeCursor: [String: Int64] = [:]
        var seq = 0
        var sawMediaSequence = false

        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty { continue }

            if line.hasPrefix("#") {
                if line.hasPrefix("#EXT-X-STREAM-INF") {
                    out.isMaster = true
                    let a = Self.attrs(Self.afterColon(line))
                    pendingVariantBW = Int(a["BANDWIDTH"] ?? a["AVERAGE-BANDWIDTH"] ?? "0") ?? 0
                    hasPendingVariant = true
                } else if line.hasPrefix("#EXTINF") {
                    let s = Self.afterColon(line)
                    let num = s.split(separator: ",").first.map(String.init) ?? s
                    lastDur = Double(num) ?? 0
                    out.duration += lastDur
                } else if line.hasPrefix("#EXT-X-TARGETDURATION") {
                    out.targetDuration = Double(Self.afterColon(line)) ?? 0
                } else if line.hasPrefix("#EXT-X-MEDIA-SEQUENCE") {
                    seq = Int(Self.afterColon(line)) ?? 0
                    sawMediaSequence = true
                } else if line.hasPrefix("#EXT-X-BYTERANGE") {
                    let s = Self.afterColon(line)
                    let parts = s.split(separator: "@")
                    let len = Int64(parts.first.map(String.init) ?? "") ?? 0
                    let off = parts.count > 1 ? Int64(parts[1]) : nil
                    pendingRange = (off, len)
                } else if line.hasPrefix("#EXT-X-KEY") {
                    let a = Self.attrs(Self.afterColon(line))
                    let method = (a["METHOD"] ?? "NONE").uppercased()
                    if method != "NONE" {
                        var ivData: Data?
                        if let ivs = a["IV"], ivs.lowercased().hasPrefix("0x") {
                            ivData = Self.hexToData(String(ivs.dropFirst(2)))
                        }
                        curKey = Key(method: method,
                                     uri: a["URI"].flatMap { URL(string: $0, relativeTo: baseURL) },
                                     iv: ivData)
                        out.encrypted = true
                    } else {
                        curKey = nil
                    }
                } else if line.hasPrefix("#EXT-X-MAP") {
                    let a = Self.attrs(Self.afterColon(line))
                    if let uri = a["URI"], let u = URL(string: uri, relativeTo: baseURL) {
                        var off: Int64?
                        var len: Int64?
                        if let br = a["BYTERANGE"] {
                            let parts = br.split(separator: "@")
                            len = Int64(parts.first.map(String.init) ?? "")
                            off = parts.count > 1 ? Int64(parts[1]) : (rangeCursor[u.absoluteString] ?? 0)
                            if let o = off, let l = len { rangeCursor[u.absoluteString] = o + l }
                        }
                        curMap = Segment(url: u, offset: off, length: len, key: curKey, sequence: 0)
                        out.map = curMap
                    }
                }
                continue
            }

            // 非 # 行 = 一个 URL
            guard let u = URL(string: line, relativeTo: baseURL)?.absoluteURL else { continue }

            if hasPendingVariant {
                out.variants.append((url: u, bandwidth: pendingVariantBW))
                hasPendingVariant = false
                pendingVariantBW = 0
                continue
            }

            if !sawMediaSequence { seq = out.segments.count }

            var off: Int64?
            var len: Int64?
            if let (o, l) = pendingRange {
                len = l
                off = o ?? (rangeCursor[u.absoluteString] ?? 0)
                rangeCursor[u.absoluteString] = (off ?? 0) + l
            }
            pendingRange = nil

            out.segments.append(Segment(url: u, offset: off, length: len, key: curKey, sequence: seq))
            seq += 1
        }

        if out.duration == 0, out.targetDuration > 0, !out.segments.isEmpty {
            out.duration = out.targetDuration * Double(out.segments.count)
        }
        return out
    }

    // MARK: 小工具

    static func afterColon(_ line: String) -> String {
        guard let i = line.firstIndex(of: ":") else { return "" }
        return String(line[line.index(after: i)...])
    }

    static func attrs(_ s: String) -> [String: String] {
        var out: [String: String] = [:]
        var key = "", val = ""
        var inKey = true, inQuote = false
        for c in s {
            if inKey {
                if c == "=" { inKey = false; val = "" }
                else if c == "," { key = "" }
                else { key.append(c) }
            } else {
                if c == "\"" { inQuote.toggle() }
                else if c == "," && !inQuote {
                    let k = key.trimmingCharacters(in: .whitespaces).uppercased()
                    if !k.isEmpty { out[k] = val }
                    key = ""; val = ""; inKey = true
                } else { val.append(c) }
            }
        }
        if !inKey {
            let k = key.trimmingCharacters(in: .whitespaces).uppercased()
            if !k.isEmpty { out[k] = val }
        }
        return out
    }

    static func hexToData(_ hex: String) -> Data? {
        var data = Data()
        var idx = hex.startIndex
        while idx < hex.endIndex {
            let next = hex.index(idx, offsetBy: 2, limitedBy: hex.endIndex) ?? hex.endIndex
            guard let b = UInt8(hex[idx..<next], radix: 16) else { return nil }
            data.append(b)
            idx = next
        }
        return data
    }
}
