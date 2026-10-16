# 视频嗅探 · iOS Safari 扩展

一个真正接入 Safari 的 iOS 扩展：嗅探页面视频地址，**由扩展后台跨域读取**时长、大小和原始直链。

---

## 先看这一段：为什么不能用 Expo Go

Expo Go 只能运行 JS/React Native 界面，它是个沙箱 App，**无法加载 iOS 的 App Extension**。
Safari 扩展是一个原生 target（`NSExtensionPointIdentifier = com.apple.Safari.web-extension`），
必须用 Xcode 编译、签名、安装。所以「Expo Go 测试 Safari 插件」在 iOS 上不存在可行路径。

正确链路是：

```
GitHub Actions (macOS runner)
   └─ XcodeGen 生成工程 → xcodebuild 编译 → 打包 IPA
          └─ 用你自备的证书签名
                 └─ AltStore / Sideloadly 装进 iPhone
                        └─ 设置 → Safari → 扩展 → 打开
```

本仓库已经配好前两步，push 上去就会自动出 IPA。

---

## 目录结构

```
project.yml                        XcodeGen 工程描述（不手写 .xcodeproj）
App/                               容器 App（纯 SwiftUI，只放使用说明）
Extension/
  SafariWebExtensionHandler.swift  原生入口
  Info.plist                       声明 Safari Web Extension 扩展点
  Resources/
    manifest.json                  MV2 清单
    background.js                  ★ 跨域探测：m3u8 解析 / 大小探测 / 取文件
    content.js                     ★ 页面嗅探 + 右下角列表 UI
    popup.html                     工具栏弹窗说明
scripts/validate.mjs               manifest + JS 语法校验（CI 与本地都能跑）
.github/workflows/build-ios.yml    编译、打包、自检（产物为未签名 IPA）
```

## 为什么扩展比油猴脚本强

| | 油猴脚本（Userscripts App） | 本扩展 |
|---|---|---|
| 跨域读 m3u8 / 读 `Content-Range` | ❌ 受 CORS 限制，只能靠运气 | ✅ 后台带 host 权限，不受页面 CORS 约束 |
| iOS 上取二进制 | ❌ `GM.xmlHttpRequest` 的 arraybuffer 有已知 bug | ✅ 标准 `fetch().arrayBuffer()` |
| 需要装第三方 App | 需要 Userscripts | 不需要 |

## 在 GitHub 上编译

1. 新建一个仓库，把本目录推上去（`main` 或 `master` 分支）。
2. Actions 会自动跑 `build-ios`。
3. 跑完在 **Artifacts** 里下载 `VideoSniffer-unsigned-ipa`。

如果只想手动触发：仓库 Actions → build-ios → Run workflow（可填 `bundle_id` 和 `version`，见下文「构建参数」）。

> 建议：**用你自己证书对应的那个 App ID 去构建**，而不是构建完再用工具改 ID。
> 因为 Safari 扩展要求 `.appex` 的 Bundle ID 必须等于主 App 的 ID 加 `.Extension`，
> 而很多自签名工具只会改主 App 的 ID，改完两者就对不上，扩展直接失效。

## 你自己签名（推荐路线）

工作流产出的 `VideoSniffer-unsigned.ipa` 就是给你重签用的，**不需要配任何 Secrets**。

先确认包内结构没毛病（工作流里已经自动检查过一遍，这里是你手动核对用）：

```
Payload/VideoSniffer.app/
├── VideoSniffer                    主程序
├── Info.plist
└── PlugIns/
    └── VideoSnifferExtension.appex/   ← Safari 扩展在这里，必须有
        ├── VideoSnifferExtension
        ├── Info.plist                （NSExtensionPointIdentifier = com.apple.Safari.web-extension）
        ├── manifest.json
        ├── background.js
        ├── content.js
        └── popup.html
```

**签名顺序不能反：**

1. 先签 `PlugIns/VideoSnifferExtension.appex`
2. 再签主 App `VideoSniffer.app`

```bash
# macOS 上手动签的例子
codesign -f -s "Apple Development: 你的名字 (XXXXXXXXXX)" \
  --entitlements ext.entitlements --timestamp=none \
  Payload/VideoSniffer.app/PlugIns/VideoSnifferExtension.appex

codesign -f -s "Apple Development: 你的名字 (XXXXXXXXXX)" \
  --entitlements app.entitlements --timestamp=none \
  Payload/VideoSniffer.app

# 检查
codesign -dv --verbose=4 Payload/VideoSniffer.app
codesign -dv --verbose=4 Payload/VideoSniffer.app/PlugIns/VideoSnifferExtension.appex
```

**Windows 上用 ESign / i4Tools / Sideloadly 这类工具时，注意这三点：**

1. 工具的「改 Bundle ID」如果只改主 App，**不要用**——扩展会失联。要么不改 ID（用与证书匹配的 ID 构建），要么用能同步改 `.appex` 的工具。
2. 本工程**没有使用任何特殊 entitlement**（没开 App Groups、没开 iCloud），所以签名最省事；如果工具问你「要不要启用扩展」，选是。
3. 装完如果 Safari 设置里看不到「视频嗅探」，八成是扩展没签上——用 Sideloadly 勾选 "Enable Safari Extension" 之类的选项重签一次。

## 关于描述文件（重要，别踩坑）

主 App 和扩展是**两个不同的 App ID**：

```
com.yourname.vsd             ← 主 App
com.yourname.vsd.Extension   ← Safari 扩展（必须严格是主 ID 加 .Extension）
```

一个 `.mobileprovision` 只绑定一个 App ID，所以**不可能用一个描述文件覆盖两者**。你需要：

- **自动签名工具（Sideloadly / AltStore）**：工具会自己为两个 ID 各生成一个描述文件，你只要保证工具的
  "bundle id" 设置里，扩展用的是主 ID + `.Extension`；有些工具需要你手动确认扩展那一步。
- **手动 codesign**：分别准备两个描述文件，先签 `.appex` 用扩展那份，再签主 App 用主 ID 那份。

本工程**刻意没有用 App Groups、iCloud、推送等任何 entitlement**，就是为了让自签名尽量少踩坑。
如果签名工具问你要不要启用扩展，选是。

## 构建参数

`workflow_dispatch` 时可以填：

| 参数 | 说明 |
|---|---|
| `bundle_id` | 你的 App ID。扩展会自动用 `你的ID.Extension`，两者始终成对 |
| `version` | 版本号，默认 `1.0.0` |

工作流里带了一步自检，会在编译后确认：

- `PlugIns/VideoSnifferExtension.appex` 确实存在
- 扩展 Bundle ID == 主 App Bundle ID + `.Extension`
- `NSExtensionPointIdentifier == com.apple.Safari.web-extension`
- `manifest.json / background.js / content.js / popup.html` 都在扩展包里

任何一条不过就直接红叉，不会给你一个「装上去却没有扩展」的废包。

## 装到 iPhone

未签名 IPA 需要用自己的证书重签，任选一种：

- **AltStore / SideStore**：电脑装 AltServer，手机装 AltStore，把 IPA 拖进去。免费 Apple ID 可用，但**证书 7 天过期**，需定期刷新。
- **Sideloadly**：数据线连电脑，拖入 IPA，填 Apple ID 即可。
- 有付费开发者账号的话，直接用自己的证书签，有效期 1 年。

装好后：

1. 设置 → 通用 → VPN与设备管理 → 信任你的证书。
2. **设置 → Safari 浏览器 → 扩展 → 视频嗅探 → 打开**。
3. 同一页把权限设为「允许」；想全站生效就选「所有网站」。
4. 打开视频页 → 右下角出现蓝色按钮 → 播放 2～3 秒 → 点按钮看列表。

## 当前版本能做什么 / 不能做什么

**能：**
- 嗅探 mp4 / m3u8 / webm / mp3 等地址（含 iframe 内播放器，按标签页聚合）
- 列表显示**名字、时长、大小**（大小走 `Range: bytes=0-0` 读 `Content-Range`，HLS 支持 `BYTERANGE` 精确求和、主列表按码率估算）
- **复制直链**（最稳的一条路：交给 Documents / nPlayer / VLC 等下载器）
- mp4 类直链「下载」按钮：后台取字节 → 页面里触发保存

**暂时不能：**
- **分片流（m3u8）合并**：需要把几百个分片拉下来解密拼接再写文件，iOS 扩展不能直接写「文件」App。
  下一步做法是加 App Group + 容器 App 里做合并与导出，工程量比这一版大。
- 大文件（>120MB）受扩展内存限制会拒绝，请用「复制直链」。

## 本地校验

```bash
node scripts/validate.mjs     # 检查 manifest 引用与 JS 语法
xcodegen generate             # 需要 macOS + XcodeGen
xcodebuild -project VideoSniffer.xcodeproj -scheme VideoSniffer -sdk iphoneos build
```

## 已知不确定点（如实说明）

- 本仓库的 Swift/Xcode 部分**没有在真机或 Xcode 上编译过**（开发环境是 Windows，无法运行 Xcode）。
  扩展的 JS 逻辑已在真实浏览器里跑过完整测试，但工程能否一次编译通过，以 GitHub Actions 的结果为准。
- `manifest_version: 2` 是为了兼容更老的 iOS Safari；如果 CI 提示 MV2 不受支持，把 `manifest.json` 改成
  `"manifest_version": 3` 并把 `background.scripts` 换成 `background.service_worker` 即可。
