# dsh-android 双端契约（移植施工图）

写给并行施工的移植工程师。**已完成并验证**（不要改）：`src/adb.ts`、
`src/frame-source.ts`、`src/android-host.ts`、`src/stream-access.ts`、
`src/stream-routes.ts`；脚手架（package.json / tsconfig 双份 / scripts/run-tool.mjs
/ build-client.mjs / cordis.patch.yml）。参考实现永远是
`/Users/kayshen/Workspace/ZSeven-W/dsh-ios`（照抄它的注释密度、错误文案风格、
defineTool 惯用法）。架构决策见 `docs/architecture.zh.md`。

## 实测事实（emulator jian-m4, Android 14, 1080×2400）

- 持久 screencap 循环 ≈ 8 fps；`ensureStreaming` 首帧 ~200 ms；`input tap` ~130 ms。
- **旋转**：帧跟随显示旋转（横屏 app 前台时 screencap = 2400×1080）；`input tap`
  坐标空间 = 当前显示空间 = 帧空间。**客户端不需要任何反向旋转/坐标逆映射**
  （删掉 iOS 版 sim-orientation.ts 整套机制）；面板只需在 img onLoad 时读
  naturalWidth/Height 适配纵横比。launcher/Settings 等锁竖屏的界面不理会
  user_rotation，这是正常 Android 行为。
- `wm size` 恒报竖屏物理尺寸，不随旋转变 —— 所以坐标换算必须用**帧尺寸**
  （android-host 已如此实现），不要用 wm size（仅作无流兜底）。

## 核心 API（已实现，直接 import 使用）

```ts
// adb.ts
class AdbToolchain {
  binary: AdbBinary; available: boolean
  requireAdb(): string                       // 不可用时 throw 解释性 AdbError
  exec(args, {serial?, timeoutMs?, maxBuffer?}): Promise<{stdout, stderr}>
  execOut(serial, cmd[], opts?): Promise<Buffer>   // 二进制安全（screencap 必走这里）
  shell(serial, cmd[], opts?): Promise<string>     // CRLF 已归一
  listDevices(): Promise<AndroidDevice[]>    // {serial, state, emulator, model?, product?}
  onlineDevices(); deviceDetails(device)     // model/androidVersion/sdk/avdName
  screenSize(serial); waitForBoot(serial, timeoutMs?)
}
resolveEmulatorBinary(); listAvds(); bootAvd(toolchain, avdName, opts?) // => {serial}
SERIAL_PATTERN; AdbError; DEFAULT_BOOT_TIMEOUT_MS

// android-host.ts
class AndroidHostController {
  toolchain; available; running; streamedSerial; latestFrame
  ensureStreaming({serial}): Promise<{serial, width?, height?}>
  subscribeFrames(cb): () => void; acquire(): () => void
  stop(); status(); dispose(); startKeepAlive(); stopKeepAlive()
  tap(serial,x,y); drag(serial,{fromX,fromY,toX,toY,duration?})  // 归一化 0..1
  button(serial,name); type(serial,text)   // 非 ASCII 自动走 ADBKeyboard 或 throw 带提示
  rotate(serial,0..3); getRotation(serial)
  deviceAction(serial, action); screenshot(serial): Promise<{png: Buffer, width?, height?}>
  resolveTarget(serial?): Promise<AndroidDevice>  // 显式→streamed→唯一在线→throw
}
ANDROID_BUTTONS  // home back recents power volume_up volume_down menu enter delete
ANDROID_DEVICE_ACTIONS = ['notifications','quick-settings','lock','wake','assistant']

// stream-routes.ts / stream-access.ts
PLUGIN_ROUTE_PREFIX = '/_dsh/dsh-android'   // stream/ screenshot/ grant switch-device
                                            // devices capture status control device-action
installStreamRoutes(ctx, host); mountStreamRoutes(webServer, routes)  // smoke 用后者
StreamAccessController; screenshotDir()     // = <tmp>/dsh-android/screenshots
nextCapturePath(serial)                     // screenshot-<safe>-<n>.png 防覆盖
AndroidRouteErrorCode = forbidden|bad_method|bad_content_type|bad_request|device_unknown
  |device_offline|device_unauthorized|device_busy|stream_not_running|stream_failed
  |token_invalid|screenshot_missing|adb_unavailable|unavailable
```

## 路由响应形状（客户端按此写 protocol.ts）

- `POST /grant {kind:'stream', device?}` → `{ok, streamUrl, expiresAt, device}`
  （**无 wsUrl —— 本插件没有 WebSocket**）；`{kind:'screenshot', path}` →
  `{ok, screenshotUrl, expiresAt}`。
- `POST /switch-device {device}` → grant 形状 + `{device, deviceName}`；只接受
  在线 serial（离线/未授权 → 409 coded）。AVD 启动不在此路由（属 android_boot）。
- `POST /devices {}` → `{ok, devices:[{serial,state,kind:'emulator'|'physical',
  model?,streaming?}], avds:[string]}` —— **单数组**，无 iOS 的双数组割裂。
- `POST /capture {device?}` → `{ok, screenshotUrl, path, bytes, expiresAt}`。
- `POST /status {device?}` → `{ok, running, serial?, deviceName?}`。
- `POST /control {device, action}`；action =
  `{kind:'tap',x,y} | {kind:'drag',fromX,fromY,toX,toY,durationMs?} |
   {kind:'button',name} | {kind:'type',text} | {kind:'rotate'}`；
  rotate 响应 `{ok, rotation:0..3}`。坐标一律归一化 0..1。
- `POST /device-action {device?, action}` → `{ok, action}`。
- 错误一律 `{ok:false, code, error}`；客户端按 code 映射 copy key，映射不到
  回退英文 error（照抄 iOS simRouteErrorTextOf 机制）。

## 工具清单（20 个，全部 `android_` 前缀）

defineTool 契约、renderJson、错误风格、timeoutMs、isConcurrencySafe 全部照抄
dsh-ios（见其 tools.ts；参数 DSL 非标准 JSON Schema：每属性 `required:true`、
object 必写 additionalProperties、schema 常量 `as const`）。**错误必 throw、
消息以 `android_<tool>:` 开头且带下一步指引；枚举失败必 throw 而非空列表。**

| 工具 | 实现要点 | meta |
|---|---|---|
| android_devices | listDevices + deviceDetails 富化 + listAvds；`avds` 单独字段 | – |
| android_boot | 参数 `device`（serial 或 AVD 名）：在线 serial → ensureStreaming；AVD 名 → bootAvd → ensureStreaming | android-stream |
| android_shutdown | emulator serial → `adb -s X emu kill` + host.stop()；实体机拒绝（指引拔线/说明不支持关真机） | – |
| android_screenshot | host.screenshot → ScreenshotStore（目录**必须**用 stream-access 的 screenshotDir()，命名同 nextCapturePath 规则） | android-screenshot |
| android_interact | tap/type/button/gesture(swipe json)/scroll；动作后 sleep 300ms 截图；scroll 沿用 iOS simScrollPath 的 8%..92% 语义（方向按内容命名） | android-screenshot |
| android_list_apps | `pm list packages [-3][-s]` + label：先 `dumpsys package` 要 versionName，label 取不到就用包名；query 过滤大小写不敏感 | – |
| android_launch_app | packageName 或 name 二选一（都给/都不给 → ToolArgsError）；`monkey -p <pkg> 1` 或 `am start`；relaunch → 先 `am force-stop` | – |
| android_build_run | detectProject（gradlew 优先）→ `assembleDebug` → 找 apk（`**/build/outputs/apk/debug/*.apk` 最新）→ `adb install -r` → 解析 applicationId（`aapt2 dump badging` 不可依赖，用 gradle 输出/AndroidManifest 兜底）→ `monkey` 启动；失败带 gradle 尾部 80 行 | android-build-run |
| android_ui_tree | `exec-out uiautomator dump /dev/tty`（fallback: dump /sdcard + pull）→ XML → {type(class 尾段), text, contentDesc, resourceId, bounds:{x,y,w,h}px, enabled, focused} → 40KB 剪深（capTreeToBytes 逻辑照抄）+ filter | – |
| android_tap_element | resource-id↔identifier、text/content-desc↔label；精确→包含、链折叠、歧义列 ≤8 候选、enabled 门；tap 中心 → 300ms 截图；expect_text/expect_gone（走 OCR 轮询，预算 4s） | android-screenshot |
| android_ui_rows | 树中重复同构子项（RecyclerView 等）→ 行 {index, frame, label(聚合), counts}；计数解析 parseCountsFromLabel 照抄 iOS list-rows.ts | – |
| android_tap_row | 行内相对坐标 tap；expect_count {key,delta} 点前 requireCountKey、点后 800ms 重读 ±1 验证；越界 index 必 FAIL 不 clamp | android-screenshot |
| android_find_text | host.screenshot → ocr-backend（像素 rect，origin 左上；Android 无 points 概念，结果就叫 pixels）；query/min_confidence(0.3)/40KB 截断 | – |
| android_tap_text | find → 中心 → host.tap（归一化 = px/frame 尺寸）；同 tap_element 的歧义/expect 语义 | android-screenshot |
| android_wait_for | appear/disappear 轮询，600ms 间隔，默认 8s 上限 60s；超时 = matched:false 非错误 | – |
| android_logs | `logcat -d -v time`（snapshot，`-t` 按 duration 换算行数或 `-T`）/ 限时 follow（spawn detached + 进程组 SIGTERM）；`bundle_id`→`--pid=$(pidof -s pkg)`；300 行/30KB LogLineRing 照抄 | – |
| android_processes | `ps -A -o PID,NAME`（过滤 filter）；返回 {pid, name} | – |
| android_backtrace | `kill -3 <pid>` 后读 `/data/anr/`（多数设备不可读 → 降级 `logcat -b crash -d` 尾部）；诚实报告 engine 和局限 | – |
| android_meminfo | `dumpsys meminfo <pkg>` 解析 TOTAL PSS/Java/Native + top 分类；对应 iOS leaks 的 summary 模式 | – |
| android_app_info | `dumpsys package <pkg>`：versionName/versionCode/dataDir/codePath/firstInstallTime/system 标志；未安装 → installed:false + note（不抛） | – |

presentationMeta 形状（客户端 hydrate 判据同步用）：
```ts
{ kind:'android-stream', device:{serial, name?, androidVersion?, state}, streamRouteId:`dsh-android/stream/${serial}` }
{ kind:'android-screenshot', path, screenshotPath, device:{...} }   // path 与 screenshotPath 故意重复
{ kind:'android-build-run', device:{...}, packageName, apkPath? }
```

工厂签名（DI 缝，smoke 依赖）：
```ts
createAndroidTools(host, { cacheDir? } = {})            // → src/tools.ts；8 个核心工具
createAndroidUiTools(host, { cacheDir? } = {})          // → src/tool-uitree.ts；ui_tree/tap_element
createAndroidOcrTools(host, { cacheDir? } = {})         // → src/tool-ocr.ts；find/tap/wait
createAndroidRowTools(host, {} = {})                    // → src/tool-list-rows.ts
createAndroidLogTools(host)                             // → src/tool-logs.ts
createAndroidDebugTools(host, { cacheDir? } = {})       // → src/tool-debug.ts；含 dispose()
registerAndroidSkill(ctx)                               // → src/skill.ts；ctx.inject(['skills'],…)
```
cacheDir 默认 `join(tmpdir(),'dsh-android')`；截图子目录 `screenshots/` 与路由共享。
index.ts 照抄 dsh-ios/src/index.ts 的 ctx.effect 逐工具注册 + installStreamRoutes(ctx, host)
+ host.startKeepAlive() + 返回 disposer；`export const name = 'dsh-android'`、
`export const inject = ['tools']`。

## OCR 移植（src/ocr-backend.ts）

从 dsh-ios/src/ocr-backend.ts 移植：assets/ocr.swift 已复制（不改）。改动仅限：
缓存 `~/Library/Caches/dsh-android/bin/ocr/…`、env 名 `DSH_ANDROID_OCR_DIR /
DSH_ANDROID_OCR_SWIFT / DSH_ANDROID_SWIFTC`、错误前缀 dsh-android、
**删除 points 换算函数**（Android 只有像素空间：保留 pixelRectToNormalized /
normalizedRectToPixels / rectCenter / filterOcrItems / parse / ensure / exec）。
非 macOS 宿主 → resolveOcrBinary 报"OCR 需要 macOS 宿主的 Vision 框架"解释性错误。

## 客户端（src/client/）

以 dsh-ios/src/client 为底本移植；分类结论已验证：
- **(a) 改名照抄**：card-styles(删旋转组)、card-boundary、details-compat、
  react-dom-compat.d.ts、sim-result、screenshot-session、panel-host、panel-dock
  （属性名换 dsh-android）、panel-trigger、panel-capture、status-capsule、select、
  panel-follow（单目标简化）。
- **(b) 适配**：index.tsx（卡片映射：android_boot=AndroidStreamCard autoOpen、
  android_screenshot/android_interact=AndroidScreenshotCard、
  android_build_run=AndroidBuildRunCard；无 real-start 卡）；protocol.ts（按上文
  路由形状重写；**无 ws**；保留 postJson/防御解析/code→copy 机制；gesture 合并
  simRealGestureActionOf 照搬：slop 0.02、move 50ms 采样、时长 clamp 0.05–2s）；
  meta-hydrate（3 种 kind 判据）；stream-session（**混血**：iOS sim-stream-session
  的 grant→img、generationRef、一次性 autoReGrant、seeded grant + settle 看门狗
  骨架，控制面换成 REST 合并手势 —— 即 sim-real-session 的指针处理接到 /control）；
  panel.tsx（删真机分支后改；>800 行拆 panel-body/panel-connected）；toolbar
  （◁ ○ □ 三键 + rotate/screenshot/refresh；删 Home 双击语义）；device-menu
  （5 个 action 对应 ANDROID_DEVICE_ACTIONS）；device-picker（单数组 + kind 分组
  图标；AVD 显示为不可点提示走 android_boot）；panel-size（DEVICE_SCALE 改从帧
  自然尺寸/2.625 兜底 412×915）；frame-style（圆角 30/412，三档保留，"手机框"）。
- **(c) 删除**：sim-real-session、sim-real-start-card、sim-orientation（整套）。
- copy.ts：en/zh 双表、SimCopy 类型由 en 推导的模式照抄；WDA 30 条删掉，新增
  back/recents/notifications 等；err* 表对齐 AndroidRouteErrorCode。
- 面板"直播中"逻辑：img onLoad naturalWidth>0 即 live（无 ws open 信号）。

## smoke / README

- harness 六助手（step/expectThrow/withEnv/makeExec/createMiniWebServer/
  loadClientExports）抽到 `scripts/_smoke-harness.mjs` 共享。
- `pnpm test` 六件套（见 package.json）全部静态可跑：adb 用 PATH 垫片
  （假 adb Node 脚本，覆盖 devices -l/exec-out screencap(二进制!)/input/getprop/
  uiautomator dump），工具用 DI 缝注入假 host。真设备 smoke（dev-emulator-smoke）
  不进 test。env 旋钮 `DSH_ANDROID_*`。
- README.md 结构对照 dsh-ios README（badge/工具表/安装/安全模型）；先 en + zh。
