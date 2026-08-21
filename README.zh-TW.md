<p align="center">
  <img src="./docs/images/dsh-android-logo.png" alt="DSH Android" width="120" />
</p>

<h1 align="center">DSH Android</h1>

<p align="center">
  <strong>把一台真實運行的 Android 裝置放進 <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> 對話裡——模擬器或 USB 手機，全部由 adb 驅動。</strong><br />
  <sub>20 個智慧代理工具 &bull; 處理程序內即時串流，無外部輔助程式 &bull; 三鍵導覽面板 &bull; Gradle 建置與執行 &bull; Vision OCR</sub>
</p>

<p align="center">
  <sub>npm: <code>@zseven-w/dsh-android</code> &middot; 目前外掛程式版本：<code>0.1.0-rc.1</code> &middot; 已在 DSH <code>0.1.1-rc.1</code> 驗證</sub>
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <b>繁體中文</b> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

<br />

<p align="center">
  <img src="./docs/images/dsh-android-overview.png" alt="DSH Android — 對話裡的即時 Android 裝置" width="100%" />
</p>
<p align="center"><sub>在 DSH 對話中直接串流並操作 Android 裝置——中間是智慧代理的工具呼叫，右側是即時裝置面板</sub></p>

## 為什麼選擇 DSH Android

DSH Android 把一台真實的 Android 裝置交給智慧代理，同時把畫面交給你。代理可以在模擬器或 USB 手機上開串流、建置並安裝 Gradle 專案、依 `resource-id`/文字或 OCR 驅動介面、讀取 logcat、檢視處理程序與記憶體；與此同時裝置畫面即時渲染在常駐的側邊欄面板裡，你可以直接在影片上點按、拖曳、旋轉，並按下 返回 / 主畫面 / 最近應用。沒有 image block，也沒有螢幕錄影檔案：可視位元組只透過 DSH webserver 提供的簽章短效 URL 抵達介面。

整個外掛程式只有一條程式碼路徑。`adb devices -l` 報出的 **serial** 就是裝置的唯一身分——`emulator-5554`、USB serial、`ip:port` 目標的行為完全一致。外掛程式不綁定任何模擬器產品（AVD、Genymotion、WSA、雲端裝置農場），也不存在「模擬器 vs 真機」兩套堆疊要分別推理。

| | |
| --- | --- |
| 📱 **對話裡的即時裝置** | **在處理程序內**產生的 `multipart/x-mixed-replace` PNG 串流，直接從最新影格緩衝區經簽章的 `/_dsh/dsh-android/*` 路由送出。 |
| 🔌 **無外部串流輔助程式，無內部連接埠** | 一個常駐的 `adb exec-out` 子處理程序執行 `while :; do screencap -p; done`，主機自己把串接的 PNG 切成影格。沒有回送串流伺服器要代理，沒有連接埠範圍要管理，異常退出後也沒有孤兒處理程序要收養。 |
| 🧩 **單一 adb 程式碼路徑** | 對 adb 而言模擬器與手機是同一種東西，對本外掛程式亦然。沒有 `simctl`/WebDriverAgent 雙堆疊，實體裝置也不必先建置、簽章再信任。 |
| 🛠️ **20 個智慧代理工具** | 裝置列舉、開機/關機、螢幕擷取、互動、Gradle 建置與執行、應用程式列舉與啟動、`uiautomator` UI 樹 + 依元素點按、清單/資訊流列級操作、Vision OCR 尋找/點按/等待、logcat、處理程序、ANR/當機回溯、meminfo、應用程式資訊。 |
| 👆 **三鍵導覽面板** | 在即時影片上點按與拖曳；工具列含 **◁ 返回 · ○ 主畫面 · □ 最近應用**，外加旋轉、螢幕擷取與重新整理；裝置選單提供通知欄、快速設定、鎖定、喚醒與語音助理。 |
| 🔐 **簽章的回送專用路由** | 每條路由在檢查任何能力憑證**之前**先要求：回送對端、回送 `Host`（拒絕 DNS 重綁定）、Fetch-Metadata/Origin 驗證。HMAC-SHA256 能力憑證 10 分鐘內過期。 |
| 🔍 **語意 + 視覺雙路自動化** | `android_ui_tree` 匯出 `uiautomator` 階層，`android_tap_element` 依 `resource-id`、文字或 content-description 點按；當 UI 樹為空、或文字被燒進圖片時，`android_find_text` / `android_tap_text` 直接對螢幕做 OCR，而不是猜座標。 |

## 工具

20 個工具在任何主機上都會註冊，並回傳純 JSON——可視位元組只經由 `presentationMeta` + 簽章路由抵達介面，絕不作為 image block。解析不到 adb 時工具照常註冊，每次呼叫都以說明修復方式的錯誤失敗。

所有座標一律是**串流影格的歸一化 0..1**。影格跟隨顯示方向旋轉（橫向 App 在 1080×2400 裝置上就是 2400×1080），而 `input tap` 用的是同一個座標空間，所以本外掛程式裡沒有任何用戶端的旋轉換算。

### 核心工具

| 工具 | 作用 | 關鍵參數 |
| --- | --- | --- |
| `android_devices` | 列出 `adb devices -l` 報出的每一台裝置（serial、狀態、模擬器/實體、型號、Android 版本、API level、AVD 名稱），並在 `avds` 欄位附上本機的 AVD 名稱。用它找出其餘工具所需的 serial。列舉失敗會拋出錯誤，而不是回傳空清單。 | — |
| `android_boot` | 啟動即時串流。傳入**線上**的 serial 會立刻開始串流；傳入 AVD 名稱則先啟動該模擬器，待它開機完成後再串流（冷啟動需數分鐘）。串流在整段對話期間保持，面板因此能持續顯示裝置。 | `device`（必填——serial 或 AVD 名稱） |
| `android_shutdown` | 關閉模擬器（`adb emu kill`），並在串流指向該裝置時一併停止串流。實體裝置會被拒絕並附上原因：adb 無法關閉手機電源。 | `device` |
| `android_screenshot` | 擷取一張 PNG 並回傳精簡的 JSON 摘要（路徑、位元組數、尺寸、裝置）；圖片渲染在卡片與面板裡，絕不作為 image block。 | `device`（可選——預設為串流中的裝置，否則是唯一線上的那一台） |
| `android_interact` | 與串流中的裝置互動：依歸一化 0..1 座標點按、輸入文字、按下導覽鍵或硬體鍵（`back`、`home`、`recents`、`power`、`volume_up`、`volume_down`、`menu`、`enter`、`delete`）、送出滑動手勢或捲動。動作沉澱（約 300 ms）後會有一張新的螢幕擷取顯示效果。 | `action`（必填——`tap`/`type`/`button`/`gesture`/`scroll`）、`x`/`y`、`text`、`name`、`json`、`device` |
| `android_list_apps` | 列出裝置上已安裝的套件（`pm list packages`），附上 `dumpsys package` 裡的版本名稱，以及可解析時的人類可讀標籤——第三方套件名稱猜不出來，所以要嘛先列舉，要嘛給 `android_launch_app` 傳 `name`。 | `device`、`query`（大小寫不敏感子字串，含 CJK）、`include_system`（預設 false） |
| `android_launch_app` | 依 `packageName` 啟動已安裝的應用程式，或依 `name`（透過同一份列舉解析的標籤子字串，大小寫不敏感）啟動。兩者只能且必須擇一。`relaunch` 會先強制停止該應用程式。 | `packageName` 或 `name`（擇一）、`device`、`relaunch` |
| `android_build_run` | 建置 Gradle 專案（`./gradlew assembleDebug`）、安裝產出的 debug APK（`adb install -r`）並啟動它。完整建置需要數分鐘；失敗時結果會帶上 Gradle 錯誤輸出的尾段。 | `projectPath`（必填）、`device` |

### UI 樹與列級工具（`uiautomator`）

| 工具 | 作用 | 關鍵參數 |
| --- | --- | --- |
| `android_ui_tree` | 把前景應用程式的 `uiautomator` 階層匯出為節點——`type`（類別名稱尾段）、`text`、`contentDesc`、`resourceId`、以像素表示的 `bounds`、`enabled`、`focused`——上限約 40 KB（先剪除最深的層級並設定 `truncated`）。 | `device`、`max_depth`、`filter`（對 text/content-description/resource-id 的大小寫不敏感子字串） |
| `android_tap_element` | 依身分點按元素——`resource_id` 比對節點的 `resource-id`，`text` 比對其文字或 content-description。先精確比對，再大小寫不敏感包含；巢狀重複項折疊為單一目標，比對有歧義時列出最多 8 個候選而不是替你挑一個。停用的元素會被拒絕。點按落在元素中心，約 300 ms 後以螢幕擷取顯示效果；傳入 `expect_text` / `expect_gone`，點按與驗證就合成一次往返。 | `device`、`resource_id`、`text`、`expect_text`、`expect_gone` |
| `android_ui_rows` | 把清單/資訊流畫面（`RecyclerView` 之類）讀成**列**而不是原始樹：重複的同構子項變成列，各自帶著索引、像素框、彙整後的標籤，以及從該標籤解析出的計數器（數字 + 量詞，中文或英文皆可——不硬寫任何 App 詞彙）。計數器的鍵可原樣回傳：把列出的鍵一字不差地交給 `android_tap_row.expect_count`。 | `device`、`max_depth` |
| `android_tap_row` | 在某個可見列內依相對位置點按（`index` 來自 `android_ui_rows`；`x`/`y` 是該列框的分數，預設 0.5 = 中心）。列框來自一次**全新**的樹讀取，因此不會猜任何絕對座標；超出範圍的索引直接失敗，絕不夾限。帶 `expect_count={key, delta}` 時，工具會在約 800 ms 後重讀該列，驗證計數器恰好變動 ±1；未知的鍵會在點按發生**之前**就被拒絕。 | `device`、`index`（必填）、`x`、`y`、`expect_count`（`{key, delta}`） |

### OCR、記錄檔與偵錯工具

| 工具 | 作用 | 關鍵參數 |
| --- | --- | --- |
| `android_find_text` | 用外掛程式自行編譯的 Vision 輔助程式對**目前**螢幕做 OCR（accurate 辨識，zh-Hans + en-US）。適用於 UI 樹為空或退化、文字被繪製成圖形（角標數字、燒進圖片的價格），或需要獨立驗證螢幕內容時。回傳 `{device, size, items:[{text, confidence, rect}]}`，其中 rect 是原點在左上角的**像素**框，依信心值排序並限制在約 40 KB。僅限 macOS 主機。 | `device`、`query`（大小寫不敏感子字串）、`min_confidence`（預設 0.3） |
| `android_tap_text` | 對**目前**螢幕做 OCR 並點按最佳文字比對的中心——規則與 `android_tap_element` 完全相同（精確 → 包含 → 列出候選），用於 UI 樹看不見的文字。比對到的像素中心會依影格尺寸歸一化後送出點按；約 300 ms 後以螢幕擷取顯示效果。僅限 macOS 主機。 | `device`、`query`（必填）、`min_confidence`、`expect_text`、`expect_gone` |
| `android_wait_for` | 等待文字出現或消失，以相同的擷取 + OCR 管線每 600 ms 輪詢一次，直到條件成立或逾時（預設 8 秒，上限 60 秒）。逾時是正常的 `matched:false` 答案，絕不是錯誤。僅限 macOS 主機。 | `device`、`text`（必填）、`mode`（`appear`/`disappear`）、`timeout_ms`、`min_confidence` |
| `android_logs` | 讀取裝置的記錄：`snapshot`（對近期視窗執行 `logcat -d -v time`，預設 2m）或 `follow`（有界的即時擷取 `duration_seconds`，預設 10、上限 60——絕不會是掛住的串流）。用 `bundle_id`（Android 套件名稱，會解析成 pid）過濾到單一應用程式。輸出上限約 300 行 / 30 KB，並附上收窄範圍的提示。 | `device`、`mode`（`snapshot`/`follow`）、`duration`、`duration_seconds`、`bundle_id`、`grep` |
| `android_processes` | 列出裝置上執行中的處理程序（`ps -A`），形如 `{pid, name}`——這是 `android_backtrace` 的 pid 來源。 | `device`、`filter`（對處理程序名稱的大小寫不敏感子字串） |
| `android_backtrace` | 要求處理程序傾印自己的堆疊（`kill -3`），再從 `/data/anr/` 讀取產生的 ANR trace。多數未 root 的裝置不允許讀取該目錄，此時工具會降級到當機緩衝區（`logcat -b crash -d`），並誠實報告是哪個引擎作答、它看不到什麼。 | `device`、`pid` 或 `bundle_id` |
| `android_meminfo` | 解析 `dumpsys meminfo <package>`：TOTAL PSS、Java/native/graphics 拆分，以及占用最高的分類——這是 Android 上對應記憶體外洩摘要的答案。 | `device`、`bundle_id`（必填） |
| `android_app_info` | 從 `dumpsys package <package>` 取得已安裝應用程式的事實：版本名稱與版本號、資料目錄、程式碼路徑、首次安裝時間，以及系統應用程式旗標。應用程式不存在時回傳 `installed: false` 加上一則指向 `android_list_apps` 的說明——不會拋出錯誤。 | `device`、`bundle_id`（必填） |

## 顯示面

- **側邊欄面板。** 即時畫面位於常駐的右側面板（固定停靠、把對話區讓開；窄視窗下退化為居中浮層）。它渲染即時 PNG 串流，並接受在影片上直接「點擊即點按」與「拖曳即手勢」，工具列含 **◁ 返回**、**○ 主畫面**、**□ 最近應用**，以及旋轉、螢幕擷取與重新整理。裝置選單執行五個裝置層級的動作（通知欄、快速設定、鎖定、喚醒、語音助理）。裝置選擇器把所有 adb 裝置放進**同一份**清單並依類型分組，未啟動的 AVD 顯示為指向 `android_boot` 的提示，而不是點一下就開機。尺寸模式與外框樣式（無框 / 邊框 / 手機外殼）與 iOS 版一致；面板從影格自身的自然尺寸推導長寬比，所以旋轉不需要任何設定。
- **緊湊對話卡片。** 工具結果渲染為不含內嵌圖片的單列卡片：裝置名稱、操作副標籤、狀態徽章，以及「在側邊欄開啟」的提示。點擊該列即可開啟面板。
- **輸入框上方的狀態膠囊。** 面板關閉且串流線上時，輸入框上方會出現一個小膠囊，點擊即可開啟面板。
- **標準模式與 Code 模式。** 標準工作階段使用主機下發的 `presentationMeta`；巢狀的 Code 模式呼叫不攜帶 meta，用戶端便從結果中的完整 JSON 重建出完全一致的 meta——面板、卡片與膠囊在兩種模式下都能工作。

## 安全

- **瀏覽器從不與 adb 通訊，而且根本不存在可通訊的內部連接埠。** 串流在本處理程序內產生、直接自記憶體送出；每一個位元組都經由 DSH webserver 源站上外掛程式自有的 `/_dsh/dsh-android/*` 路由：`/stream/<token>`（即時 multipart PNG）、`/screenshot/<token>`（快取 PNG），以及 `/grant`、`/switch-device`、`/devices`、`/capture`、`/status`、`/control` 與 `/device-action`。這比「代理一台回送串流伺服器」的攻擊面嚴格更小。
- **三重回送圍欄，在讀取任何能力憑證之前套用。** 傳輸層對端必須是回送位址，`Host` 標頭必須指向回送權威（因此 DNS 重綁定的 `Host` 會被拒絕），Fetch-Metadata/`Origin` 必須同源。Host 與 Origin 都是呼叫方可控的資料，絕不單獨採信。
- **HMAC-SHA256 能力憑證，10 分鐘內過期**，格式為 `base64url(payload).base64url(mac)`，以每個 DSH 主目錄專屬的 32 位元組金鑰簽章（`<DSH_HOME>/cache/dsh-android/stream-access.key`，權限 0600，原子建立）。為某台裝置簽發的憑證，在另一台裝置接手串流位置的瞬間即失效；螢幕擷取的憑證也無法重放到串流路由上。
- **螢幕擷取路由只提供唯一一個目錄。** 路徑以 `lstat` 逐級走查（任何符號連結一律拒絕），再以 `realpath` 收尾做包含性驗證，用 `O_NOFOLLOW` 開啟、限制大小，並在讀取後**再驗證一次**——因此在簽發與取用之間被換成符號連結的檔案永遠不會被送出。
- **`/grant` 永遠不會啟動任何東西。** 它只為已經在線上的裝置啟動影格迴圈，並且會以 409 `device_busy` 拒絕把串流從另一台裝置手上搶走。切換裝置必須走明確的 `/switch-device` 手勢；啟動 AVD 則始終屬於 `android_boot` 工具。
- **保活與閒置停止。** 崩潰的影格迴圈會在背景重啟（約 5 秒延遲）；沒有消費者時，串流閒置 5 分鐘後自行停止。主動停止絕不會被保活邏輯對抗。

## 環境需求

- **Node ≥ 24.11.0。**
- **adb**（來自 Android SDK platform-tools），解析順序如下：`ADB` 環境變數 → `PATH` 上的 `adb` → `<ANDROID_HOME>`/`<ANDROID_SDK_ROOT>`/各作業系統預設的 SDK 根目錄 + `/platform-tools/adb`。可用 `sdkmanager "platform-tools"`、Android Studio 或 `brew install --cask android-platform-tools` 安裝。沒有 adb 時外掛程式仍會載入、20 個工具照常註冊，每次呼叫都會說明缺少什麼。
- **一台裝置**：任何產品的模擬器，或已開啟 USB 偵錯的手機。`emulator` 啟動器是可選的，只有「以 AVD 名稱呼叫 `android_boot`」需要它——其餘功能只要 adb 看得見裝置就能運作。
- **DSH ≥ 0.1.0-rc.6 且使用 Web 版**，才能顯示面板。無頭（headless）設定同樣可用：20 個工具功能不變，只是沒有即時畫面。
- **OCR 需要 macOS 主機**（只有 `android_find_text` / `android_tap_text` / `android_wait_for` 需要）：外掛程式在首次使用時用 `swiftc` 把隨套件的 `assets/ocr.swift` 編譯到 `~/Library/Caches/dsh-android/bin/ocr`。在 Linux 與 Windows 主機上，這三個工具會回報 OCR 需要 macOS 的 Vision 框架；其餘 17 個不受影響。覆寫項：`DSH_ANDROID_OCR_DIR`、`DSH_ANDROID_OCR_SWIFT`、`DSH_ANDROID_SWIFTC`。
- **ADBKeyboard**（可選，用於 CJK 與 emoji 輸入）：`adb shell input text` 只支援 ASCII。在裝置上安裝 [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) 並選為使用中的輸入法後，非 ASCII 文字會透過其廣播介面投遞。沒有它時，非 ASCII 輸入會被**拒絕**並附上安裝提示——絕不會靜默打錯字。

## 實體裝置

這裡沒有 WebDriverAgent 那種要建置、簽章、信任、每七天重簽一次的東西。開啟 USB 偵錯、插上手機、在裝置上接受授權提示，它就會出現在 `android_devices` 裡，所有工具都能直接對它運作。未授權的裝置會被如實回報並附上提示，而不是變成一個莫名其妙的失敗。

三條需要坦白的限制：

- **USB 的影格率較低**——手機約 2–5 fps，模擬器約 5–10 fps，因為每一格都要以完整 PNG 穿過 USB 連結。
- **CJK 輸入需要 ADBKeyboard**（見上），模擬器與手機一視同仁。
- **`android_shutdown` 無法關閉手機電源。** adb 沒有這個動詞，工具會直說，而不是假裝做到了。

## 效能

在模擬器上實測（Android 14，1080×2400）：

| | |
| --- | --- |
| 常駐 screencap 迴圈 | ≈ 8 fps |
| `ensureStreaming` 首格 | ~200 ms |
| `input tap` 往返 | ~130 ms |

單一常駐子處理程序正是這些數字的來源：每格 spawn 一次 `adb`，光是啟動就要 ~50–100 ms 才會有像素流動。預期模擬器 ~5–10 fps、USB 手機 ~2–5 fps，隨機器與螢幕密度浮動。

## 安裝到 DSH

```sh
dsh plugin --profile web add @zseven-w/dsh-android@latest
dsh web
```

或把它加為既有 profile 套件的相依項目：

```sh
pnpm add @zseven-w/dsh-android
```

## 快速開始

1. **探索裝置**——「列出 Android 裝置。」 → `android_devices`。
2. **啟動串流**——「串流 emulator-5554。」 → `android_boot`。面板隨即開啟，裝置即時可見。（傳 AVD 名稱會先啟動該模擬器。）
3. **在影片上點按**——直接在面板上點按或拖曳，或讓代理驅動：「開啟設定，然後點顯示。」 → `android_interact`，或用 `android_ui_tree` + `android_tap_element` 做依身分的點按，或在 UI 樹失明時用 `android_find_text` + `android_tap_text`。
4. **建置並執行你的 App**——「建置並執行 /path/to/MyApp。」 → `android_build_run`。完整的 Gradle 建置需要數分鐘；完成後應用程式會啟動，你就在面板裡即時看著它。
5. **讀取記錄檔**——「顯示 com.example.app 最近兩分鐘的 logcat。」 → `android_logs`。

## 疑難排解

- **所有工具都說 adb 不可用**——錯誤訊息會點名三層解析順序。設定 `ADB=/path/to/adb`、把 `adb` 放上 `PATH`，或安裝 SDK platform-tools（`sdkmanager "platform-tools"`）。
- **裝置狀態是 `unauthorized`**——在裝置螢幕上接受 USB 偵錯的授權提示。`android_devices` 會如實回報狀態，而不是把裝置藏起來。
- **`android_boot` 找不到 AVD**——代表沒有找到 `emulator` 啟動器。用任何方式把模擬器啟動起來，adb 一看見它就會出現在 `android_devices` 裡，`android_boot` 隨後接手它的 serial。
- **非 ASCII 文字被拒絕**——安裝 ADBKeyboard 並選為輸入法（見環境需求）。這個拒絕是刻意的：`input text` 會靜默丟棄或打亂這些字元。
- **`android_find_text` 說 OCR 不可用**——OCR 需要 macOS 主機（Apple 的 Vision 框架）。其餘 17 個非 OCR 工具在哪裡都能用。
- **串流自己停了**——那是閒置策略，不是崩潰：沒有消費者（面板關閉、沒有掛載的卡片、沒有活躍路由）時，串流會在 5 分鐘後停止，並在下一次工具呼叫或開啟面板時重啟。崩潰的迴圈則會在約 5 秒內自行重啟。

## 開發

```sh
pnpm install
pnpm run build      # 主機 tsc + 用戶端打包 → lib/
pnpm run typecheck
pnpm test           # 所有靜態套件；不需要裝置
```

`scripts/` 下的 smoke 套件跑的是建置產物 `lib/`。除了需要真實裝置的 `dev-emulator-smoke.mjs`（沒有裝置時回報 SKIP 並以 0 退出）之外，其餘全部是靜態的。

| 腳本 | 覆蓋內容 |
| --- | --- |
| `node scripts/dev-adb-smoke.mjs` | adb 解析（env / PATH / SDK，對著墊片二進位檔實測）、`devices -l` 解析、二進位安全的 `exec-out`、PNG 切格器與其重新同步、input text 跳脫，以及對著假工具鏈驗證主機生命週期（串流、控制、閒置停止、dispose）。 |
| `node scripts/dev-routes-static-smoke.mjs` | 簽章路由對著假主機：相對授權、過期/偽造/跨類型 token、回送圍欄、405/415/400 信封、帶代碼的裝置拒絕、`/control` 驗證、rotate 回應形狀、螢幕擷取的目錄圍欄，以及即時 multipart 串流。 |
| `node scripts/dev-tools-smoke.mjs` | 核心工具透過 `createAndroidTools` 接縫對著假主機執行。 |
| `node scripts/dev-uitree-smoke.mjs` | UI 樹與列級工具：`uiautomator` XML 解析、選擇器、深度上限、列與計數器啟發式。 |
| `node scripts/dev-logs-smoke.mjs` | `android_logs` 的 snapshot/follow、篩選、上限與處理程序回收。 |
| `node scripts/dev-panel-smoke.mjs` | 面板元件、尺寸模式、外框樣式、dock/trigger/膠囊邏輯（僅 SSR）。 |
| `node scripts/dev-emulator-smoke.mjs [serial]` | 真實裝置：首格、持續影格率、tap 往返、dispose。 |

## 其他疑難排解
### 模擬器畫面全白 / 全黑

若面板串出來是純白（或純黑），但 `android_ui_tree` 仍看得到真實的 UI 元素，
代表這台機器上模擬器的主機 GPU framebuffer 回讀壞了（部分 macOS 主機上已知的
gfxstream 問題——`screencap` 本身就回傳空白影格，所有螢幕類工具都會受影響）。
改用軟體算繪重新啟動模擬器：

```bash
emulator -avd <name> -gpu swiftshader_indirect
```

或在該 AVD 的 `config.ini` 裡設定 `hw.gpu.mode=swiftshader_indirect`。實體裝置
永遠不受此問題影響。

## 路線圖

- **更高影格率的來源。** `StreamSource` 接縫是刻意留出的插拔點：`scrcpy-server` + WebCodecs H.264 路徑可以替換掉逐格 PNG 串流，而不必動到路由、工具或面板。
- **Compose 預覽熱重載。** iOS 版把 SwiftUI 預覽當成 dylib 熱抽換；Compose 目前沒有等價的熱抽換原語，因此這一項留作未來項目，而不是先交付一個不穩的版本。

## 生態

- [DSH iOS Simulator](https://github.com/ZSeven-W/dsh-ios) —— 同一套架構，面向 iOS 模擬器與 USB 連接的 iPhone
- [DSH Crew](https://github.com/ZSeven-W/dsh-crew) —— 從 Claude Code / Codex 把任務派給 DSH 代理
- [DSH Noema](https://github.com/ZSeven-W/dsh-noema) —— DSH 的長期記憶
- [DSH OpenPencil](https://github.com/ZSeven-W/dsh-openpencil) —— 在對話中檢視與編輯 `.op` 設計文件

## 致謝與授權

- [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools)（`adb`）—— 在執行時期解析，從不重新散布：Google 的 SDK 授權不允許捆綁。
- [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) —— Senzhk —— 非 ASCII 輸入背後的可選裝置端輸入法（Apache-2.0；未捆綁）。
- 架構與路由安全姿態與 [dsh-ios](https://github.com/ZSeven-W/dsh-ios) 共享，本外掛程式由其移植而來。
- 完整聲明見 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

**授權條款**：MIT
