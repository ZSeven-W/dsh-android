<p align="center">
  <img src="./docs/images/dsh-android-logo.png" alt="DSH Android" width="120" />
</p>

<h1 align="center">DSH Android</h1>

<p align="center">
  <strong><a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> の会話の中に、ライブで動く Android デバイスを——エミュレータでも USB 接続の実機でも、すべて adb 経由で操作。</strong><br />
  <sub>20 個のエージェントツール &bull; プロセス内ライブストリーム、外部ヘルパー不要 &bull; 3 ボタンナビゲーションパネル &bull; Gradle ビルド＆実行 &bull; Vision OCR</sub>
</p>

<p align="center">
  <sub>npm: <code>@zseven-w/dsh-android</code> &middot; 現在のプラグインリリース: <code>0.1.0-rc.1</code> &middot; DSH <code>0.1.1-rc.1</code> で動作確認済み</sub>
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <b>日本語</b> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

<br />

<p align="center">
  <img src="./docs/images/dsh-android-overview.png" alt="DSH Android — 会話の中のライブ Android デバイス" width="100%" />
</p>
<p align="center"><sub>DSH の会話の中からストリーミングして操作する Android デバイス——中央がエージェントのツール呼び出し、右側がライブデバイスパネル</sub></p>

## DSH Android を使う理由

DSH Android は、会話の中でエージェントに本物の Android デバイスを渡し、同時にあなたにはピクセルを渡します。エージェントはエミュレータでも USB 接続の実機でもストリームを開始し、Gradle プロジェクトをビルドしてインストールし、`resource-id`/テキストまたは OCR で UI を操作し、logcat を読み、プロセスとメモリを調べられます。その間、デバイスのライブ映像は常駐のサイドバーパネルに描画され、あなたは動画の上で直接タップ、ドラッグ、回転ができ、戻る / ホーム / 履歴も押せます。画像ブロックも画面録画ファイルもありません。視覚的なバイトが UI に届く経路は、DSH ウェブサーバーが提供する署名付きの短命 URL だけです。

コードパスはただ 1 本です。`adb devices -l` が報告する **serial** がデバイスの唯一の identity であり、`emulator-5554` も USB の serial も `ip:port` のターゲットもまったく同じように振る舞います。プラグインは特定のエミュレータ製品（AVD、Genymotion、WSA、クラウドのデバイスファーム）に縛られておらず、「シミュレータか実機か」という二分法を考える必要もありません。

| | |
| --- | --- |
| 📱 **会話の中のライブデバイス** | **プロセス内**で生成した `multipart/x-mixed-replace` PNG ストリームを、最新フレームのバッファから署名付き `/_dsh/dsh-android/*` ルート経由でそのまま配信します。 |
| 🔌 **外部ストリームヘルパーなし、内部ポートなし** | 常駐する 1 つの `adb exec-out` 子プロセスが `while :; do screencap -p; done` を実行し、連結された PNG はホスト自身がフレームに分割します。プロキシすべきループバックのストリームサーバーも、管理すべきポート範囲も、異常終了後に引き取るべきものもありません。 |
| 🧩 **単一の adb コードパス** | adb にとってエミュレータと実機は同じものであり、このプラグインにとっても同じです。`simctl`/WebDriverAgent の二重スタックも、実機を使う前のビルドと信頼の儀式もありません。 |
| 🛠️ **20 個のエージェントツール** | デバイス一覧、起動/シャットダウン、スクリーンショット、操作、Gradle ビルド＆実行、アプリの一覧/起動、`uiautomator` UI ツリー + 要素指定タップ、リスト/フィードの行操作、Vision OCR の検索/タップ/待機、logcat、プロセス、ANR/クラッシュのバックトレース、meminfo、アプリ情報。 |
| 👆 **3 ボタンナビゲーションパネル** | ライブ映像の上でタップとドラッグ。ツールバーには **◁ 戻る · ○ ホーム · □ 履歴**、さらに回転、スクリーンショット、更新。デバイスメニューから通知シェード、クイック設定、ロック、ウェイク、アシスタントを実行できます。 |
| 🔐 **署名付きのループバック専用ルート** | すべてのルートは、ケーパビリティを確認する**前に**ループバックのピア、ループバックの `Host`（DNS リバインディングは拒否）、Fetch-Metadata/Origin チェックを要求します。HMAC-SHA256 ケーパビリティは 10 分以内に失効します。 |
| 🔍 **セマンティック + ビジュアルの二系統自動化** | `android_ui_tree` が `uiautomator` の階層をダンプし、`android_tap_element` が `resource-id`、テキスト、content-description でタップします。ツリーが空、あるいはテキストが画像に焼き込まれている場合は、座標を推測する代わりに `android_find_text` / `android_tap_text` が画面を OCR します。 |

## ツール

20 個のツールはどのホストでも登録され、プレーンな JSON を返します——視覚的なバイトが UI に届くのは `presentationMeta` + 署名付きルート経由のみで、画像ブロックとしては決して届きません。adb を解決できない場合もツールは登録されたままで、呼び出しのたびに直し方を名指しする説明付きエラーで失敗します。

座標はどこでも**ストリームフレームの正規化 0..1** です。フレームはディスプレイの回転に追従し（横向きアプリは 1080×2400 のデバイス上で 2400×1080 として配信されます）、`input tap` も同じ座標空間を共有するため、このプラグインのどこにもクライアント側の回転計算は存在しません。

### コアツール

| ツール | 機能 | 主なパラメータ |
| --- | --- | --- |
| `android_devices` | `adb devices -l` が報告するすべてのデバイス（serial、状態、エミュレータ/実機、モデル、Android バージョン、API レベル、AVD 名）を列挙し、さらにマシン上の AVD 名を `avds` に付けて返します。他のツールが取る serial を見つけるために使います。列挙に失敗した場合は空リストではなく例外を投げます。 | — |
| `android_boot` | ライブストリームを開始します。ONLINE の serial を渡せば即座にストリーミングし、AVD 名を渡せばそのエミュレータを先に起動して、起動完了後にストリーミングします（コールドスタートは数分かかります）。ストリームは会話の間ずっと維持されるので、パネルはデバイスをライブ表示し続けられます。 | `device`（必須——serial または AVD 名） |
| `android_shutdown` | エミュレータをシャットダウンし（`adb emu kill`）、そのデバイスをストリーム中なら停止します。実機は理由付きで拒否されます。adb に電話機の電源を切る手段はありません。 | `device` |
| `android_screenshot` | PNG をキャプチャし、小さな JSON サマリー（パス、バイト数、サイズ、デバイス）を返します。画像はカードとパネルに描画され、画像ブロックとしては決して返りません。 | `device`（省略可——ストリーム中のデバイス、なければ唯一オンラインのもの） |
| `android_interact` | ストリーム中のデバイスを操作します: 正規化 0..1 座標でのタップ、テキスト入力、ナビゲーション/ハードウェアキー（`back`、`home`、`recents`、`power`、`volume_up`、`volume_down`、`menu`、`enter`、`delete`）の押下、スワイプジェスチャの送信、スクロール。操作が落ち着いた後（約 300 ms）に新しいスクリーンショットで効果を示します。 | `action`（必須——`tap`/`type`/`button`/`gesture`/`scroll`）、`x`/`y`、`text`、`name`、`json`、`device` |
| `android_list_apps` | デバイスにインストールされたパッケージ（`pm list packages`）を、`dumpsys package` のバージョン名と、解決できる場合は人間向けラベル付きで列挙します——サードパーティのパッケージ名は推測できないので、まず一覧するか、`android_launch_app` に `name` を渡してください。 | `device`、`query`（大文字小文字を区別しない部分一致。CJK も可）、`include_system`（既定 false） |
| `android_launch_app` | インストール済みアプリを `packageName` で、または `name`（同じ一覧を通して解決される、大文字小文字を区別しないラベルの部分一致）で起動します。どちらか一方のみ。`relaunch` を付けると先にアプリを強制停止します。 | `packageName` または `name`（いずれか一方）、`device`、`relaunch` |
| `android_build_run` | Gradle プロジェクトをビルドし（`./gradlew assembleDebug`）、生成された debug APK をインストールして（`adb install -r`）起動します。フルビルドには数分かかります。失敗時は結果に Gradle のエラー出力の末尾が含まれます。 | `projectPath`（必須）、`device` |

### UI ツリーと行ツール（`uiautomator`）

| ツール | 機能 | 主なパラメータ |
| --- | --- | --- |
| `android_ui_tree` | フォアグラウンドアプリの `uiautomator` 階層をノードとしてダンプします——`type`（クラス名の末尾）、`text`、`contentDesc`、`resourceId`、ピクセル単位の `bounds`、`enabled`、`focused`——上限は約 40 KB（最も深い階層から間引かれ、`truncated` が設定されます）。 | `device`、`max_depth`、`filter`（text/content-description/resource-id に対する大文字小文字を区別しない部分一致） |
| `android_tap_element` | 要素を identity でタップします——`resource_id` はノードの `resource-id` に、`text` はテキストまたは content-description に一致します。まず完全一致、次に大文字小文字を区別しない部分一致。入れ子の重複は 1 つのターゲットにまとめられ、あいまいな場合は勝手に選ばず最大 8 件の候補を列挙します。無効な要素は拒否されます。タップは要素の中心に落ち、その約 300 ms 後のスクリーンショットが効果を示します。`expect_text` / `expect_gone` を渡せば、タップと検証が 1 往復にまとまります。 | `device`、`resource_id`、`text`、`expect_text`、`expect_gone` |
| `android_ui_rows` | リスト/フィード画面（`RecyclerView` など）を生のツリーではなく**行**として読み取ります: 同じ形をした繰り返しの子要素が行になり、インデックス、ピクセルフレーム、集約されたラベル、そしてそのラベルから解析されたカウンター（数値 + 助数詞。日本語・中国語・英語いずれも可——アプリ固有の語彙はハードコードしません）を持ちます。カウンターのキーはそのまま往復できます: 列挙されたキーを一字一句そのまま `android_tap_row.expect_count` に渡してください。 | `device`、`max_depth` |
| `android_tap_row` | 表示されている 1 行の中の相対位置をタップします（`index` は `android_ui_rows` から。`x`/`y` はその行のフレームに対する割合で、既定は 0.5 = 中心）。フレームは**新しく**読み直したツリーから取得するため絶対座標を推測せず、範囲外のインデックスはクランプせず FAIL します。`expect_count={key, delta}` を付けると、約 800 ms 後に行を読み直してカウンターがちょうど ±1 動いたことを検証します。未知のキーはタップが起こる**前に**拒否されます。 | `device`、`index`（必須）、`x`、`y`、`expect_count`（`{key, delta}`） |

### OCR・ログ・デバッグツール

| ツール | 機能 | 主なパラメータ |
| --- | --- | --- |
| `android_find_text` | プラグインが自前でコンパイルした Vision ヘルパーで**現在の**画面を OCR します（accurate 認識、zh-Hans + en-US）。UI ツリーが空または退化しているとき、テキストがグラフィックとして描かれているとき（バッジの数字、画像に焼き込まれた価格）、あるいは画面の内容を独立に検証したいときに使います。`{device, size, items:[{text, confidence, rect}]}` を返し、rect は左上原点の**ピクセル**矩形で、信頼度順にソートされ約 40 KB で打ち切られます。macOS ホストのみ。 | `device`、`query`（大文字小文字を区別しない部分一致）、`min_confidence`（既定 0.3） |
| `android_tap_text` | **現在の**画面を OCR し、最良のテキスト一致の中心をタップします——完全一致 → 部分一致 → 候補列挙という `android_tap_element` とまったく同じルールで、UI ツリーからは見えないテキストに使えます。一致したピクセル中心はフレームサイズで正規化されてタップとして送られ、約 300 ms 後のスクリーンショットが効果を示します。macOS ホストのみ。 | `device`、`query`（必須）、`min_confidence`、`expect_text`、`expect_gone` |
| `android_wait_for` | テキストが現れるまたは消えるまで待機します。同じキャプチャ + OCR パイプラインを 600 ms ごとにポーリングし、条件が成立するかタイムアウトするまで続けます（既定 8 秒、最大 60 秒）。タイムアウトは正常な `matched:false` という答えであり、エラーではありません。macOS ホストのみ。 | `device`、`text`（必須）、`mode`（`appear`/`disappear`）、`timeout_ms`、`min_confidence` |
| `android_logs` | デバイスのログを読みます: `snapshot`（直近のウィンドウに対する `logcat -d -v time`、既定 2m）または `follow`（`duration_seconds` の間だけ有界にライブ取得。既定 10、最大 60——ぶら下がり続けるストリームには決してなりません）。`bundle_id`（Android のパッケージ名。pid に解決されます）で 1 つのアプリに絞り込めます。出力は約 300 行 / 30 KB で打ち切られ、絞り込みのヒントが付きます。 | `device`、`mode`（`snapshot`/`follow`）、`duration`、`duration_seconds`、`bundle_id`、`grep` |
| `android_processes` | デバイスで実行中のプロセス（`ps -A`）を `{pid, name}` として列挙します——`android_backtrace` に渡す pid の入手元です。 | `device`、`filter`（プロセス名に対する大文字小文字を区別しない部分一致） |
| `android_backtrace` | プロセスに自身のスタックをダンプさせ（`kill -3`）、生成された ANR トレースを `/data/anr/` から読み取ります。root 化されていない多くのデバイスはこのディレクトリを拒否するため、その場合はクラッシュバッファ（`logcat -b crash -d`）に縮退し、どのエンジンが答えたのか、何が見えていないのかを正直に報告します。 | `device`、`pid` または `bundle_id` |
| `android_meminfo` | `dumpsys meminfo <package>` を解析します: TOTAL PSS、Java/native/graphics の内訳、上位カテゴリ——リークサマリーに対する Android 側の答えです。 | `device`、`bundle_id`（必須） |
| `android_app_info` | `dumpsys package <package>` から得られるインストール済みアプリの事実: バージョン名とコード、データディレクトリ、コードパス、初回インストール時刻、システムフラグ。アプリが存在しない場合は `installed: false` と `android_list_apps` を名指しする note を返し、例外は投げません。 | `device`、`bundle_id`（必須） |

## 表示面

- **サイドバーパネル。** ライブ映像は常駐の右側パネルに表示されます（会話を押しのける固定ドック。狭いビューポートでは中央のオーバーレイ）。ライブ PNG ストリームを描画し、動画の上でのクリックでタップ、ドラッグでジェスチャを直接受け付けます。ツールバーには **◁ 戻る**、**○ ホーム**、**□ 履歴**、回転、スクリーンショット、更新があります。デバイスメニューからはデバイスレベルの 5 つの操作（通知シェード、クイック設定、ロック、ウェイク、アシスタント）を実行できます。デバイスピッカーはすべての adb デバイスを種別ごとにグループ化した**ひとつの**リストに並べ、オフラインの AVD はクリックで起動するのではなく `android_boot` を指すヒントとして表示します。サイズモードとフレームスタイル（フレームなし / ベゼル / 実機風の筐体）は iOS 版と同じように動作し、パネルはフレーム自身の自然なサイズからアスペクト比を導くため、回転に設定は不要です。
- **コンパクトな会話カード。** ツール結果はインライン画像なしの 1 行カードとして描画されます: デバイス名、アクションのサブラベル、ステータスバッジ、そして「サイドバーで開く」キュー。行をクリックするとパネルが開きます。
- **入力欄の上のステータスカプセル。** パネルが閉じていてストリームがオンラインの間、入力欄の上に小さなピルが表示され、クリックでパネルが開きます。
- **標準モードと Code モード。** 標準セッションはホストが投影する `presentationMeta` を使います。ネストした Code モードのディスパッチは meta を運ばないため、クライアントは永続化された結果 JSON から同一の meta を再構築します——パネル、カード、カプセルは両方のモードで機能します。

## セキュリティ

- **ブラウザが adb と通信することはなく、そもそも通信できる内部ポートが存在しません。** ストリームはこのプロセス内で生成されメモリから配信され、すべてのバイトは DSH ウェブサーバーのオリジンにあるプラグイン所有の `/_dsh/dsh-android/*` ルートを通ります: `/stream/<token>`（ライブ multipart PNG）、`/screenshot/<token>`（キャッシュ済み PNG）、さらに `/grant`、`/switch-device`、`/devices`、`/capture`、`/status`、`/control`、`/device-action`。これはループバックのストリームサーバーをプロキシする構成より厳密に小さい攻撃面です。
- **三重のループバック柵を、ケーパビリティを読む前に適用します。** トランスポートのピアはループバックアドレスでなければならず、`Host` ヘッダーはループバックの authority を指していなければならず（したがって DNS リバインディングの `Host` は拒否されます）、Fetch-Metadata/`Origin` は同一オリジンでなければなりません。Host と Origin は呼び出し側が制御できるデータなので、それ単独で信用することは決してありません。
- **10 分以内に失効する HMAC-SHA256 ケーパビリティ**。形式は `base64url(payload).base64url(mac)` で、DSH ホームごとの 32 バイト鍵（`<DSH_HOME>/cache/dsh-android/stream-access.key`、モード 0600、原子的に作成）で署名されます。あるデバイス向けに発行されたケーパビリティは、別のデバイスがストリームスロットを取った瞬間に効かなくなり、スクリーンショット用のケーパビリティをストリームルートに再生することもできません。
- **スクリーンショットルートが配信するディレクトリはただ 1 つです。** パスは `lstat` でたどられ（シンボリックリンクは一切拒否）、`realpath` による包含チェックで締めくくられ、`O_NOFOLLOW` で開かれ、サイズを制限され、読み取り後に**再検証**されます——したがって発行から取得の間にシンボリックリンクへ差し替えられたファイルが配信されることはありません。
- **`/grant` は何も起動しません。** すでにオンラインのデバイスに対してフレームループを開始するだけで、他のデバイスからストリームを奪い取ることは 409 `device_busy` で拒否します。デバイスの切り替えには明示的な `/switch-device` の操作が必要で、AVD の起動は `android_boot` ツールの仕事のままです。
- **キープアライブとアイドル停止。** クラッシュしたフレームループはバックグラウンドで再起動します（約 5 秒の遅延）。コンシューマがゼロなら、ストリームは 5 分後に自ら停止します。意図的な停止が妨げられることはありません。

## 要件

- **Node ≥ 24.11.0。**
- **adb**（Android SDK platform-tools 付属）。解決順序は次のとおりです: `ADB` 環境変数 → `PATH` 上の `adb` → `<ANDROID_HOME>`/`<ANDROID_SDK_ROOT>`/OS ごとの既定 SDK ルート + `/platform-tools/adb`。`sdkmanager "platform-tools"`、Android Studio、または `brew install --cask android-platform-tools` でインストールできます。adb がなくてもプラグインはロードされ 20 個のツールも登録され、呼び出しのたびに何が足りないかを説明します。
- **デバイス 1 台**: 製品を問わないエミュレータ、または USB デバッグを有効にした実機。`emulator` ランチャーは任意で、必要なのは「AVD 名で `android_boot` を呼ぶ」場合だけです——それ以外は adb から見えるデバイスであれば何でも動きます。
- **パネルには DSH ≥ 0.1.0-rc.6 と Web バンドル**が必要です。ヘッドレスプロファイルでも動作します: 20 個のツールはすべて通常どおり機能し、ライブ映像だけがありません。
- **OCR には macOS ホスト**（必要なのは `android_find_text` / `android_tap_text` / `android_wait_for` の 3 つだけ）: プラグインは初回使用時に同梱の `assets/ocr.swift` を `swiftc` で `~/Library/Caches/dsh-android/bin/ocr` にコンパイルします。Linux と Windows のホストでは、この 3 つのツールが OCR には macOS の Vision フレームワークが必要だと報告します。残りの 17 個は影響を受けません。上書き用の環境変数: `DSH_ANDROID_OCR_DIR`、`DSH_ANDROID_OCR_SWIFT`、`DSH_ANDROID_SWIFTC`。
- **ADBKeyboard**（任意。CJK と絵文字の入力用）: `adb shell input text` は ASCII しか扱えません。デバイスに [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) をインストールしてアクティブな IME に選ぶと、非 ASCII テキストがそのブロードキャストインターフェース経由で届きます。ない場合、非 ASCII の入力はインストールのヒント付きで**拒否**されます——黙って文字化けさせることは決してありません。

## 実機

WebDriverAgent のようにビルド・署名・信頼し、7 日ごとに再署名するものは存在しません。USB デバッグを有効にし、電話機を接続し、デバイス上の認可プロンプトを承認すれば、`android_devices` に現れてすべてのツールがそのまま使えます。未認可のデバイスは謎の失敗ではなく、プロンプトのヒント付きでそのように報告されます。

正直に伝えるべき制約が 3 つあります:

- **USB ではフレームレートが下がります**——実機で概ね 2–5 fps、エミュレータで 5–10 fps。すべてのフレームがフル PNG のまま USB リンクを渡るためです。
- **CJK の入力には ADBKeyboard が必要です**（上記参照）。これはエミュレータでも実機でも同じです。
- **`android_shutdown` は電話機の電源を切れません。** adb にその動詞はないので、ツールはできるふりをせずそう言います。

## パフォーマンス

エミュレータでの実測値（Android 14、1080×2400）:

| | |
| --- | --- |
| 常駐 screencap ループ | ≈ 8 fps |
| `ensureStreaming` の初回フレーム | ~200 ms |
| `input tap` の往復 | ~130 ms |

この数字を支えているのは常駐する 1 つの子プロセスです。フレームごとに `adb` を spawn すると、ピクセルが動き出す前に ~50–100 ms を失います。エミュレータで ~5–10 fps、USB 接続の実機で ~2–5 fps を、マシンと画面密度に応じて見込んでください。

## DSH にインストール

```sh
dsh plugin --profile web add @zseven-w/dsh-android@latest
dsh web
```

あるいは既存のプロファイルパッケージの依存関係として追加します:

```sh
pnpm add @zseven-w/dsh-android
```

## クイックスタート

1. **デバイスを探す**——「Android デバイスを一覧表示して。」 → `android_devices`。
2. **ストリームを開始**——「emulator-5554 をストリーミングして。」 → `android_boot`。パネルが開き、デバイスがライブ表示されます。（AVD 名を渡すとそのエミュレータを先に起動します。）
3. **動画の上でタップ**——パネル上で直接タップまたはドラッグするか、エージェントに操作させます: 「設定を開いて、ディスプレイをタップして。」 → `android_interact`、identity ベースのタップなら `android_ui_tree` + `android_tap_element`、ツリーが見えないときは `android_find_text` + `android_tap_text`。
4. **アプリをビルドして実行**——「/path/to/MyApp をビルドして実行して。」 → `android_build_run`。Gradle のフルビルドには数分かかります。完了するとアプリが起動し、パネルでライブに確認できます。
5. **ログを読む**——「com.example.app の直近 2 分の logcat を見せて。」 → `android_logs`。

## トラブルシューティング

- **すべてのツールが adb を利用できないと言う**——エラーが 3 段階の解決順序を名指しします。`ADB=/path/to/adb` を設定するか、`adb` を `PATH` に置くか、SDK platform-tools をインストールしてください（`sdkmanager "platform-tools"`）。
- **デバイスが `unauthorized`**——デバイスの画面で USB デバッグの認可プロンプトを承認してください。`android_devices` はデバイスを隠さず、状態を正直に報告します。
- **`android_boot` が AVD を見つけられない**——`emulator` ランチャーが見つからなかったということです。手段は問わずエミュレータを起動してください。adb が認識した時点で `android_devices` に現れ、`android_boot` はその serial を取ります。
- **非 ASCII のテキストが拒否される**——ADBKeyboard をインストールして入力メソッドに選んでください（要件を参照）。この拒否は意図的です: `input text` は該当文字を黙って落とすか壊してしまいます。
- **`android_find_text` が OCR を利用できないと言う**——OCR には macOS ホスト（Apple の Vision フレームワーク）が必要です。OCR 以外の 17 個のツールはどこでも動きます。
- **ストリームが勝手に止まる**——それはクラッシュではなくアイドルポリシーです。コンシューマがゼロ（パネルが閉じている、カードがマウントされていない、アクティブなルートがない）になるとストリームは 5 分後に停止し、次のツール呼び出しやパネルを開く操作で再開します。クラッシュしたループは約 5 秒以内に自ら再起動します。
- **ランチャーで回転がおかしい**——ランチャーや設定アプリは自身を縦向きに固定し、`user_rotation` を無視します。これはプラグインのバグではなく Android の正常な挙動です。回転を許可しているアプリの中で試してください。

## 開発

```sh
pnpm install
pnpm run build      # ホストの tsc + クライアントバンドル → lib/
pnpm run typecheck
pnpm test           # すべての静的スイート。デバイス不要
```

`scripts/` のスモークスイートはビルド済みの `lib/` を検証します。デバイスが必要でデバイスがなければ SKIP（終了コード 0）を報告する `dev-emulator-smoke.mjs` を除き、すべて静的です。

| スクリプト | カバー内容 |
| --- | --- |
| `node scripts/dev-adb-smoke.mjs` | シムのバイナリに対する adb の解決（env / PATH / SDK）、`devices -l` のパース、バイナリセーフな `exec-out`、PNG フレーム分割器とその再同期、input text のエスケープ、そして偽のツールチェーンに対するホストのライフサイクル（ストリーム、制御、アイドル停止、破棄）。 |
| `node scripts/dev-routes-static-smoke.mjs` | 偽ホストに対する署名付きルート: 相対 grant、失効/偽造/種別違いのトークン、ループバック柵、405/415/400 のエンベロープ、コード化されたデバイス拒否、`/control` の検証、rotate の形状、スクリーンショットの封じ込め、ライブ multipart ストリーム。 |
| `node scripts/dev-tools-smoke.mjs` | `createAndroidTools` の継ぎ目を通した、偽ホストに対するコアツール。 |
| `node scripts/dev-uitree-smoke.mjs` | UI ツリーと行ツール: `uiautomator` XML のパース、セレクタ、深さの上限、行とカウンターのヒューリスティック。 |
| `node scripts/dev-logs-smoke.mjs` | `android_logs` の snapshot/follow、フィルタ、上限、プロセスの回収。 |
| `node scripts/dev-panel-smoke.mjs` | パネルのコンポーネント、サイズモード、フレームスタイル、ドック/トリガー/カプセルのロジック（SSR のみ）。 |
| `node scripts/dev-emulator-smoke.mjs [serial]` | 実デバイス: 初回フレーム、持続フレームレート、タップの往復、破棄。 |

## 追加のトラブルシューティング
### エミュレータで画面が真っ白/真っ黒になる

`android_ui_tree` は実際の UI 要素を見えているのに、パネルが真っ白（または真っ黒）の
画像をストリーミングする場合、そのマシンではエミュレータのホスト GPU フレームバッファ
読み戻しが壊れています（一部の macOS ホストで知られる gfxstream の問題です——
`screencap` 自体が空白フレームを返すため、画面系のツールはすべて影響を受けます）。
ソフトウェアレンダリングでエミュレータを起動し直してください:

```bash
emulator -avd <name> -gpu swiftshader_indirect
```

または AVD の `config.ini` に `hw.gpu.mode=swiftshader_indirect` を設定します。実機が
影響を受けることはありません。

## ロードマップ

- **より高フレームレートのソース。** `StreamSource` の継ぎ目は意図的に差し替え可能にしてあります: `scrcpy-server` + WebCodecs の H.264 経路なら、ルートもツールもパネルも触らずにフレームごとの PNG ストリームを置き換えられます。
- **Compose プレビューのホットリロード。** iOS 版は SwiftUI のプレビューを dylib としてホットスワップしますが、Compose には今日それに相当するホットスワップのプリミティブがありません。そのため、これは出荷済みで不安定な機能ではなく将来の項目にとどめています。

## エコシステム

- [DSH iOS Simulator](https://github.com/ZSeven-W/dsh-ios) — iOS シミュレータと USB 接続の iPhone に向けた同じアーキテクチャ
- [DSH Crew](https://github.com/ZSeven-W/dsh-crew) — Claude Code / Codex から DSH エージェントに作業を委譲
- [DSH Noema](https://github.com/ZSeven-W/dsh-noema) — DSH の長期記憶
- [DSH OpenPencil](https://github.com/ZSeven-W/dsh-openpencil) — 会話の中で `.op` デザイン文書を閲覧・編集

## クレジットとライセンス

- [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools)（`adb`）—— 実行時に解決し、再配布は一切しません: Google の SDK ライセンスは同梱を認めていません。
- [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) —— Senzhk —— 非 ASCII 入力を支える任意のデバイス側 IME（Apache-2.0。同梱していません）。
- アーキテクチャとルートのセキュリティ姿勢は [dsh-ios](https://github.com/ZSeven-W/dsh-ios) と共有しており、本プラグインはそこから移植されました。
- 完全な通知は [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) を参照してください。

**ライセンス**: MIT
