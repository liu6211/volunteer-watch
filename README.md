# 志愿项目监控 App

监控志愿云（zhiyuanyun.com）上各个志愿团体的「发起的项目」，**一有新项目就发手机通知**。

- 团体链接自己填（支持任意省份分站、任意数量）
- 有新项目 → 手机本地通知
- 邮箱通知接口已预留（默认关闭，代码见 `src/lib/email.ts`）

---

## 一、它是怎么工作的（重要，先看这段）

### 1. 「发起的项目」其实不用点

你在网页上看到的那个「发起的项目」标签页，**数据本来就在页面 HTML 里**，只是默认隐藏：

```html
<div class="con10" id="con2" style="display:none;">
  <div id="opps"><table class="table1">
    <tr><th>项目名称</th><th>发布日期</th><th>项目状态</th></tr>
    <tr><td><a href="/app/opp/view.php?id=xxx">项目名</a></td>
        <td>2026-10-01</td><td>运行中</td></tr>
```

所以 App **不需要 WebView、不需要模拟点击、不需要登录**，直接抓 HTML 解析就行。
这样更快、更稳，也不怕页面改版（改版时会回退到「只抓链接」的兼容模式）。

### 2. ⚠️ 为什么不能用「项目 id」判断新旧

这是本项目踩过的最大一个坑，**务必不要改回去**：

实测发现站点对项目链接里的 id 做了**会话级加密**，每次请求 `PHPSESSID` 都不同，导致同一个项目的 id 每次都变：

```
第一次抓取：/app/opp/view.php?id=WyC4x3MsBPJIq
第二次抓取：/app/opp/view.php?id=GmCgDv2qWJQvp   ← 同一个项目，id 完全不同
```

但**项目名称序列完全一致**。

如果拿 id 去重，每次检查都会误报「20 个新项目」。

**解决办法**：用「**项目名称 + 发布日期 + 状态**」组成指纹，并做**多重集合计数**比较 ——
看的不是「这个指纹有没有出现过」，而是「这个指纹的条数有没有变多」。
这样连「同名活动连续几天举办」这种情况也能正确处理。

相关代码：`src/core/fingerprint.mjs`，回归测试见 `tests/parser.test.mjs`。

### 3. ⚠️ 无效团体会静默返回登录页

团体 id 写错时，站点**不会报错**，而是返回一个通用登录 / 注册页。
如果不识别，就会误判成「这个团体没有项目」。

所以解析器会主动校验页面特征（见 `validateOrgPage`）：
正常团体页有 `org_join(6385777,0)` 或 `id="tabs2"`；
登录页则有「亲，请登录」「志愿者注册」等特征。

### 4. 通知的时机（零服务器方案）

你选了「纯本地检查」方案，所以：

| 时机 | 行为 |
|---|---|
| 打开 App / 下拉刷新 | ✅ 一定检查 |
| 点「立即检查」 | ✅ 立刻检查 |
| App 在后台 | ⚠️ 由系统择机执行（Android 最短 15 分钟；iOS 由系统决定，可能很久） |

**首次添加团体时不会被刷屏**：会把当前已有的项目全部登记为「已知」基线，
之后只有真正新出现的项目才通知。

---

## 二、快速开始

```bash
cd practice-app
npm install          # 已装过可跳过
npm start            # 启动开发服务器，手机装 Expo Go 扫码即可预览
```

> 本机是 Windows，**无法本地编译 iOS**。开发预览用 Expo Go，
> 正式出包见下面第四节。

### 常用命令

```bash
npm test             # 全部测试（含真实网络请求）
npm run test:offline # 只跑离线单测（不需要网络，秒级）
npm run test:live    # 只跑真实网络端到端测试
npm run typecheck    # TypeScript 类型检查
npx expo-doctor      # 检查依赖与配置问题
```

**当前测试状态：46 个测试全部通过**（40 个离线 + 6 个真实网络）。

---

## 三、目录结构

```
practice-app/
├── src/
│   ├── core/                    ← 纯 JS 核心逻辑（Node 可直接跑单测，Metro 可直接打包）
│   │   ├── url.mjs              链接解析：各种格式 → { id, host, url }
│   │   ├── parser.mjs           抓取 + HTML 解析 + 页面有效性校验
│   │   ├── fingerprint.mjs      指纹与多重集合去重（核心，勿改回 id 方案）
│   │   └── *.d.mts              对应的类型声明
│   ├── lib/
│   │   ├── types.ts             数据类型
│   │   ├── storage.ts           AsyncStorage 持久化 + 旧数据迁移
│   │   ├── checker.ts           单个 / 批量检查
│   │   ├── store.tsx            全局状态（串行写入，防并发覆盖）
│   │   ├── notifications.ts     本地通知封装
│   │   ├── backgroundTask.ts    后台定时任务定义与注册
│   │   ├── email.ts             ⭐ 邮箱通知接口（预留，默认关闭）
│   │   └── theme.ts             配色与格式化
│   └── app/                     ← Expo Router 路由
│       ├── _layout.tsx          根布局 + Provider
│       ├── (tabs)/
│       │   ├── index.tsx        团体列表（主界面）
│       │   ├── add.tsx          添加团体
│       │   ├── notifications.tsx 通知记录
│       │   └── settings.tsx     设置
│       └── team/[id].tsx        团体详情（项目列表）
├── tests/
│   ├── parser.test.mjs          离线单测（40 个）
│   ├── live.test.mjs            真实网络端到端（6 个）
│   └── fixtures/org_page.html   真实页面样本（回归测试用）
├── eas.json                     EAS 云端构建配置
└── .github/workflows/build-ios.yml  云端生成未签名 iOS 包
```

---

## 四、怎么出安装包（Windows 上也能做）

### 4.1 Android APK —— 云端构建，最省事

项目已配好 `eas.json`，无需本地 Android SDK：

```bash
npx eas-cli@latest login          # 登录 Expo 账号
npx eas-cli@latest build --platform android --profile preview
```

跑完会给出 APK 下载链接，直接装到手机上。

> `preview` 这个 profile 已配置为输出 **APK**（而不是 aab），可直接安装。

### 4.2 iOS —— 编译在云端，签名在本地（你有自签软件）

因为 **编译 iOS 二进制必须要 Xcode（只有 macOS 有）**，所以分两步：

**第一步：云端编译出「未签名包」**

项目已配好 GitHub Actions 工作流（`.github/workflows/build-ios.yml`），
推到 GitHub 后会自动触发；也可手动跑：
仓库页面 → **Actions** → 选 `Build unsigned iOS app` → **Run workflow**。
跑完在 Artifacts 里下载 `volunteer-watch-unsigned-ipa`（未签名 ipa）。

**第二步：本地用你的自签软件签名**

用你手上的自签工具（AltStore / Sideloadly / TrollStore 等）
对那个未签名 ipa 签名后装到 iPhone 上。

> 如果你更想用 EAS 直接产出已签名的 ipa，可以走：
> `npx eas-cli@latest build --platform ios --profile preview`
> 但需要**付费** Apple 开发者账号（$99/年）并登记设备 UDID。
> 走 GitHub Actions + 自签则可以完全不碰 Apple 账号。

#### ⚠️ iOS 云端编译的三个硬约束（排查花了很久，务必保留）

这套工作流能跑通，靠的是下面三点同时满足，**缺一个就会失败**：

| # | 约束 | 原因 |
|---|---|---|
| 1 | 运行器必须是 **`macos-26`** | `macos-15` 最高只有 Xcode 26.3；expo-modules-jsi 在 26.3 下会因 Swift 严格并发的 `sending ... risks causing data races` 报错。macos-26 默认 Xcode 26.6，可正常编译。 |
| 2 | 必须切到 **Xcode 26.x** | 运行器默认可能是 16.4（Swift 6.1），而 expo-modules-jsi 的 `Package.swift` 声明 `swift-tools-version: 6.2`，Swift 6.1 直接报 `package 'apple' is using Swift tools version 6.2.0 but the installed version is 6.1.0`。 |
| 3 | 必须打**一个补丁**（见工作流 `Patch expo-modules-jsi` 步骤） | expo-modules-jsi 把 `SWIFT_RETURNS_RETAINED` 误加在构造函数上，Xcode 26.2+ 的 Clang 会报错。**已确认上游 58.0.7 仍未修复**，所以在 CI 内临时修补。 |

另外两个容易踩的点：

- **不要**把 `swiftLanguageModes` 从 `.v6` 改成 `.v5`。虽然能绕过并发报错，但会禁用
  Swift 6 的正则字面量语法，导致 `JavaScriptRuntime.swift` 里的
  `/^[a-zA-Z_$]...$/` 解析失败（`'$' is not a valid digit in integer literal`）。
- **不要**在 macOS 上用 `sed -i`。BSD sed 要求 `sed -i ''`，否则会把替换脚本
  当成备份后缀而报错。工作流里统一用 `perl -pi -e`。

#### iOS 后台任务需要的 Info.plist 配置

`expo-background-task` 自带配置插件，但**必须把 `expo-background-task` 列进
`app.json` 的 `plugins` 才会生效**。否则打包出的 ipa 里
`UIBackgroundModes` 只有 `fetch`、`BGTaskSchedulerPermittedIdentifiers` 为空，
后台自动检查在 iOS 上会静默失效。

项目里做了双保险：既列了插件，也在 `app.json` 里显式写了这两项：

```json
"ios": {
  "infoPlist": {
    "UIBackgroundModes": ["fetch", "processing"],
    "BGTaskSchedulerPermittedIdentifiers": [
      "com.expo.modules.backgroundtask.processing"
    ]
  }
}
```

打包后可以这样自检（解压 ipa 读 Info.plist）：

```bash
unzip -o volunteer-watch-unsigned.ipa -d /tmp/ipa
python3 -c "
import plistlib, glob
p = glob.glob('/tmp/ipa/Payload/*.app/Info.plist')[0]
d = plistlib.load(open(p,'rb'))
print('bundleId :', d['CFBundleIdentifier'])
print('bgModes  :', d.get('UIBackgroundModes'))
print('bgIds    :', d.get('BGTaskSchedulerPermittedIdentifiers'))
"
```

### 4.3 出包前的配置（已设置，供参考）

---

## 五、邮箱通知接口怎么启用

接口已经写好并接进流程了，默认关闭。启用只需两步：

1. 打开 `src/lib/email.ts`，填 `SMTP_CONFIG`（两种方案任选其一）：
   - **方案 A（推荐）**：填 `relayEndpoint`，指向你自己的中转接口
   - **方案 B**：填 `apiEndpoint` / `apiKey` / `from`，用 Resend、SendGrid 等邮件服务商的 HTTP API
2. 在 App 的「设置 → 邮箱通知」里打开开关，并填收件邮箱

> React Native 里没有内置 SMTP 客户端，直连 SMTP 需要原生模块，
> 所以推荐走 HTTP 接口（方案 A / B）。未配置时 `sendMail()` 会静默返回失败，不会报错打扰用户。

---

## 六、已知限制（诚实说明）

| 限制 | 说明 |
|---|---|
| iOS 后台检查不准时 | 苹果系统限制，`BGTaskScheduler` 决定何时执行，可能间隔很久；App 被上滑关掉后不再检查。**打开 App 一定会检查**。 |
| Android 最短 15 分钟 | WorkManager 的硬性下限，且各厂商省电策略不同（部分国产系统会更激进地杀掉后台）。 |
| 无法做到「秒级即时」 | 这需要服务器持续监控并下发推送。当前是零服务器方案，如需真即时可后续加后端。 |
| 依赖站点 HTML 结构 | 站点改版可能导致解析失败（会报错提示，且有回退解析）。 |
| 未做登录态 | 抓的是公开页面，不需要账号。若某团体设置了仅成员可见，则抓不到。 |

---

## 七、本机环境注意事项（踩过的坑）

### 用 Expo Go 在 iPhone 上预览（实测有效的流程）

这是本项目实际跑通的调试方式，记录下来避免重复踩坑：

1. **iOS 真机上 Expo Go 必须登录 Expo 账号**。Expo 官方文档明确说明：
   物理 iOS 设备上，Expo Go 只在 **Expo CLI 与 Expo Go 登录同一账号**时才能打开项目。
   不登录会报 `You need to be signed in to Expo Go and Expo CLI`。

2. **新版 Expo Go 删掉了「手动输入 URL」入口**。首页只有自动发现列表，
   所以必须用**扫码**方式进入：生成 `exp://<电脑局域网IP>:8081` 的二维码，
   用 iPhone 相机扫 → 选择在 Expo Go 中打开。

   本仓库自带生成脚本（IP 变了重新生成即可）：

   ```bash
   cd .tools
   node make-qr.mjs "exp://192.168.x.x:8081" "expo-qr.png"
   ```

3. **不要用 `--tunnel`**，除非你确实需要。tunnel 需要 Expo 账号且会走公网，
   延迟更高。局域网直连（`--lan`）更快。

4. **自动发现（mDNS）在很多路由器下不工作**。如果 Expo Go 列表一直是空的，
   不用怀疑代码 —— 直接扫码。判断网络是否真的通：用 Safari 打开
   `http://<电脑IP>:8081`，能返回内容就说明手机能连到电脑。

5. **Expo Go 的能力限制**（会打印警告，属正常）：
   - 后台定时任务不可用 → 设置页会显示「系统限制，后台检查不可用」
   - 远程推送不可用（本地通知可用）

   这两项只有**正式构建的包**才能测。

### npm 12 的 `allow-scripts` 限制

本机 npm 版本较新，用户级 `.npmrc` 里有一份 `allow-scripts` 白名单。
这会导致 **`npx expo install <包>` 失败**（报 `EALLOWSCRIPTS`）：

```
npm error --allow-scripts is not allowed in project-scoped installs.
```

**解决办法**：手动把包写进 `package.json`，再跑 `npm install`：

```bash
npm install
```

### react-dom 必须与 react 同版本

Expo SDK 57 锁定 `react@19.2.3`。如果 `react-dom` 被抓成 19.3.0，
`npm install` 会因 peer 冲突报 `ERESOLVE`。所以项目里显式钉住了：

```json
"react": "19.2.3",
"react-dom": "19.2.3",
```

> 如果以后升级 SDK，记得让这两个版本保持一致，不要用 `--force` 硬装。

### web 平台必须做降级

`expo-notifications` 和 `expo-background-task` 在 web 上部分方法**根本不存在**，
直接调用会抛 `is not available on web` 并把整个 App 打崩。

项目里的处理方式：

- 通知：`src/lib/notifications.ts` 里所有入口都过 `NOTIFICATIONS_SUPPORTED` 判断
- 后台任务：拆成 `backgroundTask.native.ts` + `backgroundTask.web.ts`，
  Metro 按平台自动选择；`backgroundTask.ts` 只做类型转发

> 验证方法：`npx expo export --platform web` 后 grep 产物里有没有
> `expo-background-task` / `expo-task-manager`，没有才算降级成功。

### 出包前建议跑一遍自检

```bash
npx expo-doctor
```

当前状态：**20/21 项通过**。唯一失败的一项是
`Validate packages against React Native Directory package metadata`
（Expo 官方服务器无响应，与项目无关）。

---

## 八、下一步可以做的

- [ ] 加服务器（Cloudflare Workers 定时任务）+ 推送，实现真即时通知
- [ ] 抓取历史留档，做「项目时间线」视图
- [ ] 支持分组 / 批量导入团体
- [ ] 项目报名截止提醒
