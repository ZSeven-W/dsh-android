<h1 align="center">DSH Android</h1>

<p align="center">
  <strong>把一台真实运行的 Android 设备放进 <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> 对话里 —— 模拟器或 USB 手机，全部由 adb 驱动。</strong><br />
  <sub>20 个 agent 工具 &bull; 进程内直播流，无外部依赖 &bull; 三键导航面板 &bull; Gradle 构建运行 &bull; Vision OCR</sub>
</p>

<p align="center">
  <sub>npm: <code>@zseven-w/dsh-android</code> &middot; 当前插件版本: <code>0.1.0-rc.1</code> &middot; 已在 DSH <code>0.1.0-rc.6</code> 上验证</sub>
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <b>简体中文</b>
</p>

## 为什么用 DSH Android

DSH Android 把一台真实的 Android 设备交给 agent，同时把画面交给你。agent 可以在模拟器或 USB 手机上开流、构建并安装 Gradle 工程、按 `resource-id`/文本或 OCR 驱动界面、读取 logcat、检查进程与内存；与此同时设备画面实时渲染在侧边栏面板里，你可以直接在视频上点击、拖拽、旋转，并按下 返回 / 主页 / 多任务。没有 image block，也没有录屏文件：可视字节只通过 DSH webserver 提供的签名短时 URL 抵达界面。

整个插件只有一条代码路径。`adb devices -l` 报出的 **serial** 就是设备的唯一身份 —— `emulator-5554`、USB serial、`ip:port` 目标行为完全一致。插件不绑定任何模拟器产品（AVD / Genymotion / WSA / 云真机），也不存在"模拟器 vs 真机"两套栈要分别推理。

| | |
| --- | --- |
| 📱 **对话里的实时设备** | **进程内**生成的 `multipart/x-mixed-replace` PNG 流，直接从最新帧缓冲经签名路由 `/_dsh/dsh-android/*` 送出。 |
| 🔌 **无外部流服务、无内部端口** | 一个常驻 `adb exec-out` 子进程跑 `while :; do screencap -p; done`，宿主自己把连续 PNG 切成帧。没有 loopback 流服务器要代理，没有端口区间要管理，也没有异常退出后的孤儿进程要收养。 |
| 🧩 **单一 adb 代码路径** | 对 adb 而言模拟器与手机是同一种东西，对本插件同样如此。没有 `simctl`/WebDriverAgent 双栈，真机也不需要先构建签名再信任。 |
| 🛠️ **20 个 agent 工具** | 设备枚举、开流/关机、截图、交互、Gradle 构建运行、应用列举与启动、`uiautomator` 控件树 + 按元素点击、列表行操作、Vision OCR 查找/点击/等待、logcat、进程、ANR/崩溃栈、meminfo、应用信息。 |
| 👆 **三键导航面板** | 在直播画面上点击与拖拽；工具栏含 **◁ 返回 · ○ 主页 · □ 多任务**，外加旋转、截图、刷新；设备菜单提供通知栏、快捷设置、锁屏、唤醒、语音助手五个动作。 |
| 🔐 **签名的 loopback 专属路由** | 每条路由在读取任何 capability **之前**先要求：loopback 对端、loopback `Host`（拒绝 DNS 重绑定）、Fetch-Metadata/Origin 校验。HMAC-SHA256 capability 10 分钟内过期。 |
| 🔍 **语义 + 视觉双路自动化** | `android_ui_tree` 导出 `uiautomator` 层级，`android_tap_element` 按 `resource-id`、文本或 content-description 点击；当控件树为空或文字被烧进图片时，`android_find_text` / `android_tap_text` 直接 OCR 屏幕，而不是猜坐标。 |

## 工具

20 个工具在任何宿主上都会注册，返回纯 JSON —— 可视字节只经由 `presentationMeta` + 签名路由抵达界面，绝不作为 image block。adb 解析不到时工具照常注册，每次调用返回带修复指引的可解释错误。

所有坐标一律是**流画面的归一化 0..1**。帧跟随显示旋转（横屏 app 在 1080×2400 设备上就是 2400×1080），而 `input tap` 用的是同一个坐标空间，所以本插件的客户端里没有任何旋转换算。

### 核心工具

| 工具 | 作用 | 关键参数 |
| --- | --- | --- |
| `android_devices` | 列出 `adb devices -l` 报出的每台设备（serial、状态、模拟器/实体、型号、Android 版本、API level、AVD 名），以及本机的 AVD 名列在 `avds` 字段。用它拿到其余工具需要的 serial。枚举失败会抛错，而不是返回空列表。 | — |
| `android_boot` | 开启直播流。传入**在线** serial 立即开流；传入 AVD 名则先启动该模拟器，等它启动完成后再开流（冷启动需数分钟）。流在整个对话期间保持，面板因此能持续显示设备。 | `device`（必填 —— serial 或 AVD 名） |
| `android_shutdown` | 关闭模拟器（`adb emu kill`）并在流指向它时停流。实体机会被拒绝并说明原因：adb 没有关闭手机电源的动词。 | `device` |
| `android_screenshot` | 抓一张 PNG 并返回精简 JSON 摘要（路径、字节数、尺寸、设备）；图片渲染在卡片与面板里，绝不作为 image block。 | `device`（可选 —— 默认流中设备，其次唯一在线设备） |
| `android_interact` | 与流中设备交互：按归一化 0..1 坐标点击、输入文本、按导航或硬件键（`back`、`home`、`recents`、`power`、`volume_up`、`volume_down`、`menu`、`enter`、`delete`）、发送滑动手势或滚动。动作沉降约 300 ms 后自动截图展示效果。 | `action`（必填 —— `tap`/`type`/`button`/`gesture`/`scroll`）、`x`/`y`、`text`、`name`、`json`、`device` |
| `android_list_apps` | 列出设备上已安装的包（`pm list packages`），附带 `dumpsys package` 里的版本名，以及能取到时的人类可读标签 —— 第三方包名猜不出来，所以要么先列举，要么给 `android_launch_app` 传 `name`。 | `device`、`query`（大小写不敏感子串，含中文）、`include_system`（默认 false） |
| `android_launch_app` | 按 `packageName` 启动已安装应用，或按 `name`（经同一列举解析的标签子串，大小写不敏感）启动。二者必须且只能给一个。`relaunch` 会先 force-stop。 | `packageName` 或 `name`（二选一）、`device`、`relaunch` |
| `android_build_run` | 构建 Gradle 工程（`./gradlew assembleDebug`）、安装产出的 debug APK（`adb install -r`）并启动。完整构建耗时数分钟；失败时结果里带 Gradle 错误输出的尾部。 | `projectPath`（必填）、`device` |

### 控件树与列表行工具（`uiautomator`）

| 工具 | 作用 | 关键参数 |
| --- | --- | --- |
| `android_ui_tree` | 导出前台应用的 `uiautomator` 层级为节点 —— `type`（类名尾段）、`text`、`contentDesc`、`resourceId`、像素 `bounds`、`enabled`、`focused` —— 上限约 40 KB（先剪最深层并置 `truncated`）。 | `device`、`max_depth`、`filter`（对 text/content-description/resource-id 的大小写不敏感子串） |
| `android_tap_element` | 按身份点击元素 —— `resource_id` 匹配节点的 `resource-id`，`text` 匹配其文本或 content-description。先精确匹配，再大小写不敏感包含；嵌套重复项折叠为一个目标，歧义时列出最多 8 个候选而不是替你挑一个。disabled 元素会被拒绝。点击落在元素中心，约 300 ms 后截图展示效果；传 `expect_text` / `expect_gone` 则点击与验证合成一个回合。 | `device`、`resource_id`、`text`、`expect_text`、`expect_gone` |
| `android_ui_rows` | 把列表/信息流界面（`RecyclerView` 之类）读成**行**而不是原始树：重复的同构子项变成行，各带索引、像素 frame、聚合标签，以及从该标签里解析出的计数器（数字 + 量词，中英文皆可 —— 不硬编码任何 app 词汇）。计数器 key 可原样回传：把列出的 key 一字不差地交给 `android_tap_row.expect_count`。 | `device`、`max_depth` |
| `android_tap_row` | 在某个可见行内按相对位置点击（`index` 来自 `android_ui_rows`；`x`/`y` 是该行 frame 的分数，默认 0.5 = 中心）。行 frame 来自一次**全新**的树读取，因此不猜任何绝对坐标；越界 index 直接 FAIL，绝不 clamp。带 `expect_count={key, delta}` 时，工具在约 800 ms 后重读该行并验证计数器恰好变化 ±1；key 不在该行已解析的计数器里则**点击前**就拒绝执行。 | `device`、`index`（必填）、`x`、`y`、`expect_count`（`{key, delta}`） |

### OCR、日志与调试工具

| 工具 | 作用 | 关键参数 |
| --- | --- | --- |
| `android_find_text` | 用插件自编译的 Vision 助手对**当前**屏幕做 OCR（accurate 识别，zh-Hans + en-US）。适用于控件树为空或退化、文字被渲染成图形（角标数字、烧进图片的价格），或需要独立验证屏幕内容时。返回 `{device, size, items:[{text, confidence, rect}]}`，rect 是**像素**框、原点左上，按置信度排序，上限约 40 KB。仅 macOS 宿主。 | `device`、`query`（大小写不敏感子串）、`min_confidence`（默认 0.3） |
| `android_tap_text` | 对**当前**屏幕做 OCR 并点击最佳匹配的中心 —— 歧义规则与 `android_tap_element` 相同（精确 → 包含 → 列候选），用于控件树看不见的文字。匹配到的像素中心按帧尺寸归一化后作为点击发出；约 300 ms 后截图展示效果。仅 macOS 宿主。 | `device`、`query`（必填）、`min_confidence`、`expect_text`、`expect_gone` |
| `android_wait_for` | 等待文字出现或消失，用与 `android_find_text` 相同的截图 + OCR 管线每 600 ms 轮询一次，直到条件成立或超时（默认 8 s，上限 60 s）。超时是正常的 `matched:false` 答案，绝不是错误。仅 macOS 宿主。 | `device`、`text`（必填）、`mode`（`appear`/`disappear`）、`timeout_ms`、`min_confidence` |
| `android_logs` | 读设备日志：`snapshot`（`logcat -d -v time` 取近期窗口，默认 2m）或 `follow`（限时实况抓取 `duration_seconds`，默认 10，上限 60 —— 绝不挂起）。用 `bundle_id`（Android 包名，会解析成 pid）过滤到单个应用。输出上限约 300 行 / 30 KB，并附收窄提示。 | `device`、`mode`（`snapshot`/`follow`）、`duration`、`duration_seconds`、`bundle_id`、`grep` |
| `android_processes` | 列出设备上运行的进程（`ps -A`），形如 `{pid, name}` —— 这是 `android_backtrace` 的 pid 来源。 | `device`、`filter`（对进程名的大小写不敏感子串） |
| `android_backtrace` | 让进程转储自身调用栈（`kill -3`），再从 `/data/anr/` 读取 ANR trace。多数未 root 设备不允许读该目录，此时工具降级到崩溃缓冲区（`logcat -b crash -d`），并**诚实报告**是哪个引擎作答、它看不到什么。 | `device`、`pid` 或 `bundle_id` |
| `android_meminfo` | 解析 `dumpsys meminfo <package>`：TOTAL PSS、Java/native/graphics 拆分与占用最高的分类 —— 这是 Android 上对应 leaks summary 的答案。 | `device`、`bundle_id`（必填） |
| `android_app_info` | 从 `dumpsys package <package>` 取已安装应用的事实：版本名与版本号、数据目录、代码路径、首次安装时间、系统应用标志。未安装则返回 `installed: false` 加一条指向 `android_list_apps` 的说明 —— 不抛错。 | `device`、`bundle_id`（必填） |

## 展示面

- **侧边栏面板。** 实时画面在常驻的右侧面板里（固定停靠时把对话挤到一边，窄视口下则是居中浮层）。它渲染直播 PNG 流，并接受在视频上直接"点击即点按"与"拖拽即手势"，工具栏含 **◁ 返回**、**○ 主页**、**□ 多任务**，以及旋转、截图、刷新。设备菜单运行五个设备级动作（通知栏、快捷设置、锁屏、唤醒、语音助手）。设备选择器把所有 adb 设备放进**一个**列表并按类型分组，未启动的 AVD 显示为指向 `android_boot` 的提示而非点击即启动。尺寸档位与边框样式（无框 / 边框 / 手机框）与 iOS 版一致；面板从帧自身的自然尺寸推导纵横比，所以旋转不需要任何配置。
- **紧凑对话卡片。** 工具结果渲染为不含内嵌图片的单行卡片：设备名、动作副标签、状态徽标，以及"在侧边栏打开"的提示。点击行即打开面板。
- **输入框上方的状态胶囊。** 面板关闭且流在线时，输入框上方出现一个小胶囊，点击即打开面板。
- **标准模式与 Code Mode。** 标准会话使用宿主投影的 `presentationMeta`；嵌套的 Code Mode 分发不携带 meta，客户端便从持久化的结果 JSON 重建出完全相同的 meta —— 面板、卡片、胶囊在两种模式下都工作。

## 安全模型

- **浏览器从不与 adb 通信，而且根本不存在可通信的内部端口。** 流在本进程内生成、从内存送出；每一个字节都经由 DSH webserver 源上插件自有的 `/_dsh/dsh-android/*` 路由：`/stream/<token>`（实时 multipart PNG）、`/screenshot/<token>`（缓存 PNG），以及 `/grant`、`/switch-device`、`/devices`、`/capture`、`/status`、`/control`、`/device-action`。这比"代理一个 loopback 流服务器"的攻击面严格更小。
- **三重 loopback 围栏，在读取任何 capability 之前生效。** 传输层对端必须是 loopback 地址，`Host` 头必须指向 loopback 权威（因此 DNS 重绑定的 `Host` 会被拒绝），Fetch-Metadata/`Origin` 必须同源。Host 与 Origin 是调用方可控的数据，绝不单独采信。
- **HMAC-SHA256 capability，10 分钟内过期**，格式为 `base64url(payload).base64url(mac)`，用每个 DSH home 一把的 32 字节密钥签名（`<DSH_HOME>/cache/dsh-android/stream-access.key`，权限 0600，原子创建）。为某台设备签发的 capability 在另一台设备接管流位的瞬间即失效；截图 capability 也无法重放到流路由上。
- **截图路由只服务唯一一个目录。** 路径用 `lstat` 逐级走查（任何符号链接一律拒绝），以 `realpath` 收尾做包含性校验，用 `O_NOFOLLOW` 打开、限制大小，并在读完后**再校验一次** —— 因此在签发与取用之间被换成符号链接的文件永远不会被送出。
- **`/grant` 永不启动任何东西。** 它只为已经在线的设备启动帧循环，并且会以 409 `device_busy` 拒绝把流从另一台设备手上抢走。切换设备必须走显式的 `/switch-device` 手势；启动 AVD 则始终属于 `android_boot` 工具。
- **保活与空闲停止。** 崩掉的帧循环在后台重启（约 5 s 延迟）；消费者归零 5 分钟后流自行停止。主动停止绝不会被保活逻辑对抗。

## 环境要求

- **Node ≥ 24.11.0。**
- **adb**（来自 Android SDK platform-tools），解析顺序：`ADB` 环境变量 → `PATH` 上的 `adb` → `<ANDROID_HOME>`/`<ANDROID_SDK_ROOT>`/各操作系统默认 SDK 根目录下的 `/platform-tools/adb`。可用 `sdkmanager "platform-tools"`、Android Studio，或 `brew install --cask android-platform-tools` 安装。没有 adb 时插件照常载入、20 个工具照常注册，每次调用会说明缺什么。
- **一台设备**：任意产品的模拟器，或开启了 USB 调试的手机。`emulator` 启动器是可选的，只有"用 AVD 名调 `android_boot`"需要它 —— 其余功能只要 adb 看得见设备就能工作。
- **DSH ≥ 0.1.0-rc.6 且带 web bundle** 才有面板。headless 配置同样可用：20 个工具功能不变，只是没有实时画面。
- **OCR 需要 macOS 宿主**（只有 `android_find_text` / `android_tap_text` / `android_wait_for` 需要）：插件在首次使用时用 `swiftc` 把随包的 `assets/ocr.swift` 编译到 `~/Library/Caches/dsh-android/bin/ocr`。在 Linux 与 Windows 宿主上，这三个工具会报告 OCR 需要 macOS 的 Vision 框架；其余 17 个不受影响。覆盖项：`DSH_ANDROID_OCR_DIR`、`DSH_ANDROID_OCR_SWIFT`、`DSH_ANDROID_SWIFTC`。
- **ADBKeyboard**（可选，用于中文与 emoji 输入）：`adb shell input text` 只支持 ASCII。在设备上安装 [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) 并选为当前输入法后，非 ASCII 文本会经其广播接口投递。没装时非 ASCII 输入会被**拒绝**并给出安装提示 —— 绝不静默打错字。

## 实体设备

这里没有 WebDriverAgent 那种要构建、签名、信任、每七天重签一次的东西。开启 USB 调试、插上手机、在设备上确认授权弹窗，它就出现在 `android_devices` 里，所有工具直接可用。未授权的设备会被如实报告并附上确认弹窗的提示，而不是变成一个莫名其妙的失败。

三条需要坦白的限制：

- **USB 帧率更低** —— 手机约 2–5 fps，模拟器约 5–10 fps，因为每一帧都要以完整 PNG 穿过 USB 链路。
- **中文输入需要 ADBKeyboard**（见上），模拟器与手机一视同仁。
- **`android_shutdown` 关不掉手机。** adb 没有这个动词，工具会直说，而不是假装做到了。

## 性能实测

在模拟器上实测（Android 14，1080×2400）：

| | |
| --- | --- |
| 常驻 screencap 循环 | ≈ 8 fps |
| `ensureStreaming` 首帧 | ~200 ms |
| `input tap` 往返 | ~130 ms |

单个常驻子进程正是这个数字的来源：每帧 spawn 一次 `adb` 光进程开销就要 ~50–100 ms。预期模拟器 ~5–10 fps、USB 手机 ~2–5 fps，随机器与屏幕密度浮动。

## 安装进 DSH

```sh
dsh plugin --profile web add @zseven-w/dsh-android@latest
dsh web
```

或作为既有 profile 包的依赖加入：

```sh
pnpm add @zseven-w/dsh-android
```

## 快速上手

1. **发现设备** —— "列出 Android 设备。" → `android_devices`。
2. **开流** —— "把 emulator-5554 投出来。" → `android_boot`。面板打开，设备实时可见。（传 AVD 名会先启动该模拟器。）
3. **在画面上点** —— 直接在面板上点击或拖拽；或让 agent 驱动："打开设置，然后点显示。" → `android_interact`，或 `android_ui_tree` + `android_tap_element` 做身份点击，或在控件树失明时用 `android_find_text` + `android_tap_text`。
4. **构建并运行你的 app** —— "构建并运行 /path/to/MyApp。" → `android_build_run`。完整 Gradle 构建耗时数分钟；落地后应用启动，你在面板里实时看着。
5. **读日志** —— "看 com.example.app 最近两分钟的 logcat。" → `android_logs`。

## 疑难排查

- **所有工具都说 adb 不可用** —— 错误信息会点名三级解析顺序。设置 `ADB=/path/to/adb`、把 `adb` 放上 `PATH`，或安装 SDK platform-tools（`sdkmanager "platform-tools"`）。
- **设备状态是 `unauthorized`** —— 在设备屏幕上确认 USB 调试授权弹窗。`android_devices` 会如实报告状态，而不是把设备藏起来。
- **`android_boot` 找不到 AVD** —— 说明没发现 `emulator` 启动器。用任何方式把模拟器启动起来，adb 一看见它就会出现在 `android_devices` 里，`android_boot` 随后接管它的 serial。
- **非 ASCII 文本被拒绝** —— 安装 ADBKeyboard 并选为输入法（见环境要求）。这个拒绝是刻意的：`input text` 会静默丢弃或打乱这些字符。
- **`android_find_text` 说 OCR 不可用** —— OCR 需要 macOS 宿主（Apple Vision 框架）。另外 17 个工具在哪里都能用。
- **流自己停了** —— 那是空闲策略而非崩溃：消费者归零（面板关闭、无卡片挂载、无路由活动）5 分钟后流停止，下一次工具调用或打开面板时重启。崩掉的循环约 5 秒内自行重启。
- **在桌面上旋转没反应** —— launcher 和"设置"会把自己钉在竖屏并忽略 `user_rotation`。这是正常的 Android 行为而非插件缺陷；在允许旋转的应用里旋转即可。

## 开发

```sh
pnpm install
pnpm run build      # 宿主 tsc + 客户端打包 → lib/
pnpm run typecheck
pnpm test           # 全部静态套件；不需要设备
```

`scripts/` 下的 smoke 套件跑的是构建产物 `lib/`。除 `dev-emulator-smoke.mjs` 需要真设备（没设备时报 SKIP 并以 0 退出）外，其余全部静态。

| 脚本 | 覆盖内容 |
| --- | --- |
| `node scripts/dev-adb-smoke.mjs` | adb 三级解析（env / PATH / SDK，对着垫片二进制实测）、`devices -l` 解析、二进制安全的 `exec-out`、PNG 切帧器与其重同步、input text 转义，以及宿主生命周期（开流、控制、空闲停止、dispose，对着假 toolchain）。 |
| `node scripts/dev-routes-static-smoke.mjs` | 签名路由对着假 host：相对 URL grant、过期/伪造/跨类型 token、loopback 围栏、405/415/400 信封、coded 设备拒绝、`/control` 校验、rotate 响应形状、截图目录围栏，以及实时 multipart 流。 |
| `node scripts/dev-tools-smoke.mjs` | 核心工具经 `createAndroidTools` DI 缝对着假 host 运行。 |
| `node scripts/dev-uitree-smoke.mjs` | 控件树与行工具：`uiautomator` XML 解析、选择器、深度剪裁、行与计数器启发式。 |
| `node scripts/dev-logs-smoke.mjs` | `android_logs` 的 snapshot/follow、过滤、上限与进程回收。 |
| `node scripts/dev-panel-smoke.mjs` | 面板组件、尺寸档位、边框样式、dock/trigger/胶囊逻辑（仅 SSR）。 |
| `node scripts/dev-emulator-smoke.mjs [serial]` | 真设备：首帧、持续帧率、tap 往返、dispose。 |

## 排障
### 模拟器画面全白 / 全黑

若面板流出来是纯白（或纯黑），但 `android_ui_tree` 仍能看到真实控件，说明这台
机器上模拟器 host-GPU 模式的 framebuffer 读回坏了（部分 macOS 上的 gfxstream
已知问题——`screencap` 本身就返回空白帧，所有屏幕类工具都会受影响）。用软渲染
重启模拟器：

```bash
emulator -avd <名称> -gpu swiftshader_indirect
```

或在该 AVD 的 `config.ini` 里设 `hw.gpu.mode=swiftshader_indirect`。真机不受
此问题影响。

## 路线图

- **更高帧率的帧源。** `StreamSource` 接口是刻意留出的插拔缝：`scrcpy-server` + WebCodecs H.264 路径可以替换掉逐帧 PNG 流，而不必改动路由、工具或面板。
- **Compose 预览热重载。** iOS 版把 SwiftUI 预览编成 dylib 热替换；Compose 目前没有等价的热替换原语，因此这一项留在未来，而不是先做一个不稳的版本。
- **其余 13 个语种 README。** 现在先发英文与简体中文，iOS 版携带的其他语种随后跟上。

## 生态

- [DSH iOS Simulator](https://github.com/ZSeven-W/dsh-ios) —— 同一套架构，面向 iOS 模拟器与 USB 连接的 iPhone
- [DSH Crew](https://github.com/ZSeven-W/dsh-crew) —— 从 Claude Code / Codex 向 DSH agent 派活
- [DSH Noema](https://github.com/ZSeven-W/dsh-noema) —— DSH 的长期记忆
- [DSH OpenPencil](https://github.com/ZSeven-W/dsh-openpencil) —— 在对话里查看与编辑 `.op` 设计文档

## 致谢与许可

- [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools)（`adb`）—— 运行时解析，从不重分发：Google 的 SDK 许可不允许捆绑。
- [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) —— Senzhk —— 非 ASCII 输入背后的可选设备端输入法（Apache-2.0；未捆绑）。
- 架构与路由安全姿态与 [dsh-ios](https://github.com/ZSeven-W/dsh-ios) 共享，本插件由其移植而来。
- 完整声明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

**许可**：MIT
