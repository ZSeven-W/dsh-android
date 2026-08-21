# dsh-android 架构设计（v1）

移植自 dsh-ios（同一 DSH 插件形态：22 工具 + 侧边栏直播面板 + 签名路由），
但针对 Android 的关键决策全部重新推导。

## 决策 0：纯 adb 中心（用户拍板）

每台机器装的模拟器都不一样（AVD / Genymotion / WSA / 真机 / 云机），所以插件
**不绑定任何模拟器实现**：

- 设备的唯一身份 = `adb devices -l` 报出的 **serial**（`emulator-5554`、USB
  serial、`ip:port` 均可）。模拟器与真机走**同一条代码路径** —— 没有 iOS 版
  simctl/WDA 双栈，也没有 WDA 那套 build/tunnel/信任状态机。
- `emulator` 二进制只是**可选发现项**（顺序：`ANDROID_HOME` / `ANDROID_SDK_ROOT`
  → 从 adb 自身位置推 SDK 根 → PATH）。发现不了 → `android_boot` 对 AVD 名报
  可解释错误，其余全部工具照常工作。
- adb 本身的发现顺序：`ADB` 环境变量 → PATH → SDK 常见路径。找不到 adb =
  插件不可用（工具照常注册、调用时报可解释错误 —— 与 dsh-ios 非 macOS 降级
  同款风格）。

## 决策 1：进程内流服务器（去掉 serve-sim 依赖）

dsh-ios 的痛点（serve-sim 子进程、孤儿收养、npx 60 倍性能悬崖）在 Android 上
根本不需要：插件自己就是流服务器。

- **帧源**：每设备一个持久 `adb exec-out` 子进程跑
  `while :; do screencap -p; done`，宿主按 PNG 签名 + IEND 切帧，保留最新帧。
  单个持久子进程避免了每帧 spawn adb（约 50–100ms）的开销。
- **分发**：路由 handler 直接从帧缓冲写 `multipart/x-mixed-replace`（PNG part，
  Chromium/Firefox 均支持）。**没有内部端口**——比 dsh-ios 的 127.0.0.1 代理
  攻击面更小，也没有端口区间管理。
- 帧率预期：模拟器 ~5-10fps，USB 真机 ~2-5fps。够 agent 面板用；未来可插拔
  scrcpy-server + WebCodecs 源（StreamSource 接口留好）。
- 无消费者 5 分钟空闲即停帧循环（同 dsh-ios idle 语义）；崩溃自动重启。

## 决策 2：控制面 = POST /control（去掉 WS 中继）

iOS 版 WS 中继是 serve-sim 的历史契约。Android 控制动词全部是短命 adb 命令，
POST 一发一收即可（与 iOS 真机 /real-control 同款形状，客户端只需一种 session）：

- tap/drag：归一化 0..1 × 当前帧像素尺寸 → `input tap` / `input swipe`（drag
  带 duration ms）。
- button：home/back/recents/power/volume_up/volume_down →
  `input keyevent KEYCODE_*`。**Android 三键取代 iOS Home 单键**。
- type：ASCII → `input text`（转义）；含非 ASCII（CJK）→ 依次尝试
  ADBKeyboard 广播（若装了）→ 报带安装提示的可解释错误。
- rotate：`settings put system user_rotation 0..3`（先关 accelerometer_rotation）。

## 决策 3：语义自动化 = uiautomator dump（AXe/WDA 的对应物）

- `android_ui_tree`：`uiautomator dump /dev/tty` → XML → 节点
  {resource-id, text, content-desc, class, bounds}，40KB 截断 + 深度裁剪同 iOS。
- `android_tap_element`：按 resource-id/text/content-desc 精确→子串匹配，
  嵌套去重、歧义列候选、expect_text/expect_gone 一回合验证 —— 语义照搬 iOS。
- rows/tap_row：list-rows 启发式（计数器解析、±1 验证、真机 probe-guard）
  几乎原样移植，bounds 来自 uiautomator。
- OCR 三件套（find_text/tap_text/wait_for）：宿主端 Vision（ocr.swift）**原样
  复用** —— 输入只是 PNG，macOS 宿主可用；非 macOS 宿主报可解释错误。

## 决策 4：工具清单（v1 = 20 个，android_ 前缀）

devices / boot / shutdown / screenshot / interact / list_apps / launch_app /
build_run（Gradle assembleDebug → install → am start）/ ui_tree / tap_element /
ui_rows / tap_row / find_text / tap_text / wait_for / logs（logcat 快照+限时
follow）/ processes（ps -A）/ meminfo（dumpsys meminfo）/ crashes（logcat -b
crash）/ app_info（dumpsys package）。

**不做**：preview 热重载（Compose 无 dylib 热换等价物，标注 future）；
backtrace/leaks 的 lldb 等价物（debuggerd 需 root，v1 以 crashes 缓冲替代）。

## 保持一致（照搬 dsh-ios 的部分）

- 签名路由层：HMAC-SHA256 capability（10 分钟过期）、loopback 三重 fence
  （peer + Host + Fetch-Metadata/Origin）、截图目录 realpath 围栏、
  `/_dsh/dsh-android/*` 前缀、grant 永不 boot / switch-device 显式手势例外。
- 插件形态：cordis apply/ctx.effect 注册、headless 无 webServer 也能载入、
  skill playbook、presentationMeta + 签名 URL（可视字节永不走 image block）。
- 客户端面板：尺寸/边框/拖拽/自动打开逻辑复用；工具栏 iOS 键位换成
  Back/Home/Recents；设备菜单去掉 WDA Start 流程（真机即插即用）。
- 脚手架：tsconfig 双份、run-tool/build-client、dev-*-smoke mock 风格、
  cordis.patch.yml、peer+dev 双列依赖。
