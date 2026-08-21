<p align="center">
  <img src="./docs/images/dsh-android-logo.png" alt="DSH Android" width="120" />
</p>

<h1 align="center">DSH Android</h1>

<p align="center">
  <strong>Perangkat Android langsung di dalam percakapan <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> — emulator atau ponsel USB, digerakkan sepenuhnya melalui adb.</strong><br />
  <sub>20 alat agen &bull; aliran langsung dalam proses, tanpa helper eksternal &bull; panel navigasi tiga tombol &bull; build &amp; jalankan Gradle &bull; Vision OCR</sub>
</p>

<p align="center">
  <sub>npm: <code>@zseven-w/dsh-android</code> &middot; Rilis plugin saat ini: <code>0.1.0-rc.1</code> &middot; Diuji dengan DSH <code>0.1.1-rc.1</code></sub>
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <b>Bahasa Indonesia</b>
</p>

<br />

<p align="center">
  <img src="./docs/images/dsh-android-overview.png" alt="DSH Android — perangkat Android langsung di dalam percakapan" width="100%" />
</p>
<p align="center"><sub>Perangkat Android yang dialirkan dan dikendalikan dari dalam percakapan DSH — panggilan alat agen di tengah, panel perangkat langsung di kanan</sub></p>

## Mengapa DSH Android

DSH Android memberi agen perangkat Android sungguhan di dalam percakapan — dan memberi Anda pikselnya. Agen dapat memulai aliran pada emulator atau ponsel yang terhubung USB, membangun dan memasang proyek Gradle, menggerakkan UI lewat `resource-id`/teks atau lewat OCR, membaca logcat, serta memeriksa proses dan memori, sementara aliran langsung perangkat dirender di panel samping persisten tempat Anda bisa mengetuk, menyeret, memutar, dan menekan Back / Home / Recents langsung pada video. Tanpa blok gambar dan tanpa file rekaman layar: byte visual hanya mencapai UI melalui URL bertanda tangan dan kedaluwarsa yang disajikan server web DSH.

Hanya ada satu jalur kode. `adb devices -l` melaporkan sebuah **serial**, dan serial itulah satu-satunya identitas sebuah perangkat — `emulator-5554`, serial USB, atau target `ip:port` semuanya berperilaku identik. Plugin ini tidak terikat pada produk emulator mana pun (AVD, Genymotion, WSA, ladang perangkat awan), dan tidak ada pemisahan simulator/perangkat asli yang perlu dipikirkan.

| | |
| --- | --- |
| 📱 **Perangkat langsung dalam percakapan** | Aliran PNG `multipart/x-mixed-replace` yang diproduksi **dalam proses** dan disajikan langsung dari buffer bingkai terbaru melalui rute `/_dsh/dsh-android/*` bertanda tangan. |
| 🔌 **Tanpa helper aliran eksternal, tanpa port internal** | Satu proses anak `adb exec-out` persisten menjalankan `while :; do screencap -p; done`; host sendiri yang memecah PNG bersambung menjadi bingkai. Tidak ada server aliran loopback untuk diproksikan, tidak ada rentang port untuk dikelola, dan tidak ada apa pun untuk diadopsi setelah keluar secara kasar. |
| 🧩 **Satu jalur kode adb** | Emulator dan ponsel adalah hal yang sama bagi adb maupun bagi plugin ini. Tanpa tumpukan ganda `simctl`/WebDriverAgent, tanpa ritual build-dan-percayai sebelum perangkat fisik bisa dipakai. |
| 🛠️ **20 alat agen** | Perangkat, nyalakan/matikan, tangkapan layar, interaksi, build &amp; jalankan Gradle, pencantuman/peluncuran aplikasi, pohon UI `uiautomator` + ketuk per elemen, aksi baris daftar/umpan, temukan/ketuk/tunggu teks dengan Vision OCR, logcat, proses, backtrace ANR/crash, meminfo, info aplikasi. |
| 👆 **Panel navigasi tiga tombol** | Ketuk dan seret pada video langsung; bilah alat dengan **◁ Back · ○ Home · □ Recents** plus putar, tangkapan layar, dan segarkan; menu perangkat untuk panel notifikasi, pengaturan cepat, kunci, bangunkan, dan asisten. |
| 🔐 **Rute bertanda tangan khusus loopback** | Setiap rute mewajibkan peer loopback, `Host` loopback (DNS rebinding ditolak), dan pemeriksaan Fetch-Metadata/Origin — sebelum kapabilitas apa pun diperiksa. Kapabilitas HMAC-SHA256 kedaluwarsa dalam 10 menit. |
| 🔍 **Otomasi semantik + visual** | `android_ui_tree` membuang hierarki `uiautomator` dan `android_tap_element` mengetuk berdasarkan `resource-id`, teks, atau content-description; saat pohon kosong atau teksnya tercetak di dalam gambar, `android_find_text` / `android_tap_text` meng-OCR layar alih-alih menebak koordinat. |

## Alat

Ke-20 alat terdaftar di setiap host dan hanya mengembalikan JSON polos — byte visual hanya mencapai UI melalui `presentationMeta` + rute bertanda tangan, tidak pernah sebagai blok gambar. Saat adb tidak dapat diselesaikan, alat tetap terdaftar dan setiap panggilan gagal dengan error penjelas yang menyebutkan cara memperbaikinya.

Koordinat selalu **ternormalisasi 0..1 terhadap bingkai yang dialirkan**. Bingkai mengikuti rotasi layar (aplikasi lanskap dialirkan 2400×1080 pada perangkat 1080×2400) dan `input tap` berbagi ruang yang sama, sehingga tidak ada perhitungan rotasi di sisi klien di mana pun dalam plugin ini.

### Alat inti

| Alat | Fungsinya | Parameter utama |
| --- | --- | --- |
| `android_devices` | Mencantumkan setiap perangkat yang dilaporkan `adb devices -l` (serial, status, emulator/fisik, model, versi Android, level API, nama AVD) plus nama AVD di mesin ini di bawah `avds`. Gunakan untuk menemukan serial yang diterima alat lain. Enumerasi yang gagal melempar error alih-alih mengembalikan daftar kosong. | — |
| `android_boot` | Memulai aliran langsung. Teruskan serial yang ONLINE untuk langsung mengalirkannya, atau nama AVD untuk meluncurkan emulator itu lebih dulu lalu mengalirkannya setelah selesai boot (bisa beberapa menit saat mulai dingin). Aliran tetap hidup selama percakapan sehingga panel dapat menampilkan perangkat secara langsung. | `device` (wajib — sebuah serial atau nama AVD) |
| `android_shutdown` | Mematikan emulator (`adb emu kill`) dan menghentikan aliran bila aliran menarget perangkat tersebut. Perangkat fisik ditolak beserta alasannya: adb tidak dapat mematikan daya sebuah ponsel. | `device` |
| `android_screenshot` | Menangkap PNG dan mengembalikan ringkasan JSON singkat (path, byte, dimensi, perangkat); gambar dirender di kartu dan panel, tidak pernah sebagai blok gambar. | `device` (opsional — perangkat yang dialirkan, jika tidak maka satu-satunya yang daring) |
| `android_interact` | Berinteraksi dengan perangkat yang dialirkan: ketuk pada koordinat ternormalisasi 0..1, ketik teks, tekan tombol navigasi atau perangkat keras (`back`, `home`, `recents`, `power`, `volume_up`, `volume_down`, `menu`, `enter`, `delete`), kirim gestur usap, atau gulir. Setelah aksi tenang (~300 ms) tangkapan layar baru memperlihatkan efeknya. | `action` (wajib — `tap`/`type`/`button`/`gesture`/`scroll`), `x`/`y`, `text`, `name`, `json`, `device` |
| `android_list_apps` | Mencantumkan paket yang terpasang pada perangkat (`pm list packages`), lengkap dengan nama versi dari `dumpsys package` dan label manusiawi bila dapat diselesaikan — nama paket pihak ketiga tidak dapat ditebak, jadi cantumkan dulu atau teruskan `name` ke `android_launch_app`. | `device`, `query` (substring tanpa membedakan huruf besar/kecil, termasuk CJK), `include_system` (default false) |
| `android_launch_app` | Meluncurkan aplikasi terpasang lewat `packageName`, atau lewat `name` (substring label tanpa membedakan huruf besar/kecil, diselesaikan lewat pencantuman yang sama). Tepat salah satu dari keduanya. `relaunch` menghentikan paksa aplikasi lebih dulu. | `packageName` atau `name` (tepat satu), `device`, `relaunch` |
| `android_build_run` | Membangun proyek Gradle (`./gradlew assembleDebug`), memasang APK debug hasilnya (`adb install -r`), dan meluncurkannya. Build penuh memakan waktu beberapa menit; saat gagal, hasilnya memuat ekor keluaran error Gradle. | `projectPath` (wajib), `device` |

### Alat pohon UI dan baris (`uiautomator`)

| Alat | Fungsinya | Parameter utama |
| --- | --- | --- |
| `android_ui_tree` | Membuang hierarki `uiautomator` dari aplikasi terdepan sebagai node — `type` (ekor nama kelas), `text`, `contentDesc`, `resourceId`, `bounds` dalam piksel, `enabled`, `focused` — dibatasi ~40 KB (level terdalam dipangkas dan `truncated` disetel). | `device`, `max_depth`, `filter` (substring tanpa membedakan huruf besar/kecil pada teks/content-description/resource-id) |
| `android_tap_element` | Mengetuk elemen berdasarkan identitas — `resource_id` cocok dengan `resource-id` node; `text` cocok dengan teks atau content-description-nya. Cocok persis dulu, lalu substring tanpa membedakan huruf besar/kecil; duplikat bersarang diciutkan menjadi satu target dan kecocokan ambigu mencantumkan hingga 8 kandidat alih-alih memilih salah satu. Elemen yang nonaktif ditolak. Ketukan mendarat di tengah elemen, lalu tangkapan layar ~300 ms memperlihatkan efeknya; teruskan `expect_text` / `expect_gone` dan ketukan beserta verifikasinya menjadi satu perjalanan pulang-pergi. | `device`, `resource_id`, `text`, `expect_text`, `expect_gone` |
| `android_ui_rows` | Membaca layar daftar/umpan (`RecyclerView` dan kerabatnya) sebagai BARIS, bukan pohon mentah: anak-anak berbentuk sama yang berulang menjadi baris yang membawa indeks, frame dalam piksel, label gabungan, dan penghitung yang diurai dari label itu (angka + token pengklasifikasi, bahasa Tionghoa atau Inggris — tanpa kosakata aplikasi yang dikodekan). Kunci penghitung dapat bolak-balik: teruskan sebuah kunci persis seperti yang tercantum ke `android_tap_row.expect_count`. | `device`, `max_depth` |
| `android_tap_row` | Mengetuk pada posisi relatif di dalam satu baris yang terlihat (`index` dari `android_ui_rows`; `x`/`y` sebagai pecahan frame baris itu, default 0.5 = tengah). Frame berasal dari pembacaan pohon yang SEGAR, jadi tidak ada koordinat absolut yang ditebak, dan indeks di luar rentang GAGAL alih-alih dijepit. Dengan `expect_count={key, delta}` alat membaca ulang baris setelah ~800 ms dan memverifikasi penghitung bergeser tepat ±1; kunci yang tidak dikenal MENOLAK ketukan sebelum terjadi. | `device`, `index` (wajib), `x`, `y`, `expect_count` (`{key, delta}`) |

### Alat OCR, log, dan debug

| Alat | Fungsinya | Parameter utama |
| --- | --- | --- |
| `android_find_text` | Meng-OCR layar SAAT INI dengan helper Vision yang dikompilasi plugin (pengenalan akurat, zh-Hans + en-US). Gunakan saat pohon UI kosong atau menurun, untuk teks yang dirender sebagai grafis (angka badge, harga yang tercetak dalam gambar), atau untuk memverifikasi secara independen apa yang ada di layar. Mengembalikan `{device, size, items:[{text, confidence, rect}]}` dengan rect berupa kotak **piksel** berasal kiri-atas, terurut berdasarkan keyakinan dan dibatasi ~40 KB. Khusus host macOS. | `device`, `query` (substring tanpa membedakan huruf besar/kecil), `min_confidence` (default 0.3) |
| `android_tap_text` | Meng-OCR layar SAAT INI dan mengetuk pusat kecocokan teks terbaik — aturan persis → mengandung → daftar kandidat yang sama seperti `android_tap_element`, untuk teks yang tidak terlihat pohon UI. Pusat piksel yang cocok dinormalisasi terhadap ukuran bingkai lalu dikirim sebagai ketukan; setelah ~300 ms tangkapan layar baru memperlihatkan efeknya. Khusus host macOS. | `device`, `query` (wajib), `min_confidence`, `expect_text`, `expect_gone` |
| `android_wait_for` | Menunggu sampai sebuah teks muncul atau hilang, mem-polling pipeline tangkap + OCR yang sama setiap 600 ms hingga kondisinya terpenuhi atau waktu habis (bawaan 8 dtk, maks. 60 dtk). Timeout adalah jawaban normal `matched:false`, tidak pernah error. Khusus host macOS. | `device`, `text` (wajib), `mode` (`appear`/`disappear`), `timeout_ms`, `min_confidence` |
| `android_logs` | Membaca apa yang dicatat perangkat: `snapshot` (`logcat -d -v time` pada jendela waktu terakhir, default 2m) atau `follow` (tangkapan langsung terbatas selama `duration_seconds`, default 10, maksimal 60 — tidak pernah aliran yang menggantung). Saring ke satu aplikasi dengan `bundle_id` (nama paket Android, diselesaikan menjadi pid-nya). Output dibatasi ~300 baris / 30 KB dengan petunjuk penyempitan. | `device`, `mode` (`snapshot`/`follow`), `duration`, `duration_seconds`, `bundle_id`, `grep` |
| `android_processes` | Mencantumkan proses yang berjalan pada perangkat (`ps -A`) sebagai `{pid, name}` — sumber pid untuk `android_backtrace`. | `device`, `filter` (substring tanpa membedakan huruf besar/kecil pada nama proses) |
| `android_backtrace` | Meminta proses membuang tumpukannya (`kill -3`) dan membaca jejak ANR hasilnya dari `/data/anr/`. Sebagian besar perangkat non-root menolak direktori itu, sehingga alat menurun ke buffer crash (`logcat -b crash -d`) dan melaporkan secara jujur mesin mana yang menjawab serta apa yang tidak dapat dilihatnya. | `device`, `pid` atau `bundle_id` |
| `android_meminfo` | Mengurai `dumpsys meminfo <package>`: total PSS, pembagian Java/native/grafis, dan kategori teratas — jawaban Android untuk ringkasan kebocoran. | `device`, `bundle_id` (wajib) |
| `android_app_info` | Fakta aplikasi terpasang dari `dumpsys package <package>`: nama dan kode versi, direktori data, path kode, waktu pemasangan pertama, dan tanda sistem. Aplikasi yang tidak ada mengembalikan `installed: false` plus catatan yang menyebut `android_list_apps` — bukan melempar error. | `device`, `bundle_id` (wajib) |

## Permukaan tampilan

- **Panel samping.** Tampilan langsung berada di panel kanan persisten (dok tetap yang menyingkirkan percakapan, atau hamparan terpusat pada viewport sempit). Panel merender aliran PNG langsung dan menerima klik-untuk-mengetuk serta seret-untuk-gestur langsung pada video, dengan bilah alat yang memuat **◁ Back**, **○ Home**, **□ Recents**, putar, tangkapan layar, dan segarkan. Menu perangkat menjalankan lima aksi tingkat perangkat (panel notifikasi, pengaturan cepat, kunci, bangunkan, asisten). Pemilih perangkat mencantumkan setiap perangkat adb dalam SATU daftar, dikelompokkan menurut jenis, dengan AVD yang luring ditampilkan sebagai petunjuk yang mengarah ke `android_boot` alih-alih boot-saat-diklik. Mode ukuran dan gaya bingkai (tanpa bingkai / bezel / cangkang ponsel) bekerja seperti pada kembaran iOS-nya; panel menyesuaikan rasio aspeknya dari ukuran alami bingkai itu sendiri, sehingga rotasi tidak butuh konfigurasi apa pun.
- **Kartu percakapan ringkas.** Hasil alat dirender sebagai kartu satu baris tanpa citra sebaris: nama perangkat, sublabel aksi, lencana status, dan isyarat “buka di panel samping”. Mengeklik baris membuka panel.
- **Kapsul status di atas input.** Saat panel tertutup dan sebuah aliran daring, pil kecil muncul di atas kolom input dan membuka panel saat diklik.
- **Mode standar dan Mode Code.** Sesi standar memakai `presentationMeta` yang diproyeksikan host; dispatch Mode Code bersarang tidak membawa meta, jadi klien merekonstruksi meta yang identik dari JSON hasil yang tahan lama — panel, kartu, dan kapsul bekerja di kedua mode.

## Keamanan

- **Peramban tidak pernah berbicara dengan adb, dan tidak ada port internal untuk diajak bicara.** Aliran diproduksi di dalam proses ini dan disajikan dari memori; setiap byte melintasi origin server web DSH melalui rute `/_dsh/dsh-android/*` milik plugin: `/stream/<token>` (PNG multipart langsung), `/screenshot/<token>` (PNG ter-cache), plus `/grant`, `/switch-device`, `/devices`, `/capture`, `/status`, `/control`, dan `/device-action`. Ini adalah permukaan serangan yang jelas lebih kecil daripada server aliran loopback yang diproksikan.
- **Pagar loopback rangkap tiga, diterapkan sebelum kapabilitas apa pun dibaca.** Peer transport harus berupa alamat loopback, header `Host` harus menyebut otoritas loopback (sehingga `Host` DNS-rebinding ditolak), dan Fetch-Metadata/`Origin` harus same-origin. Host dan Origin adalah data yang dikendalikan pemanggil dan tidak pernah dipercaya begitu saja.
- **Kapabilitas HMAC-SHA256 yang kedaluwarsa dalam 10 menit**, berformat `base64url(payload).base64url(mac)` dan ditandatangani dengan kunci 32 byte per-rumah-DSH (`<DSH_HOME>/cache/dsh-android/stream-access.key`, mode 0600, dibuat secara atomik). Kapabilitas yang dicetak untuk satu perangkat berhenti bekerja begitu perangkat lain mengambil slot aliran, dan kapabilitas tangkapan layar tidak dapat diputar ulang terhadap rute aliran.
- **Rute tangkapan layar hanya menyajikan tepat satu direktori.** Path ditelusuri dengan `lstat` (tautan simbolis apa pun ditolak), diakhiri pemeriksaan pembendungan `realpath`, dibuka dengan `O_NOFOLLOW`, dibatasi ukurannya, dan divalidasi ulang setelah pembacaan — sehingga file yang ditukar menjadi symlink antara pencetakan dan pengambilan tidak pernah disajikan.
- **`/grant` tidak pernah mem-boot apa pun.** Ia hanya memulai loop bingkai untuk perangkat yang sudah daring, dan menolak (409 `device_busy`) merebut aliran dari perangkat lain. Berpindah perangkat menuntut gestur `/switch-device` yang eksplisit; mem-boot AVD tetap menjadi urusan alat `android_boot`.
- **Keep-alive dan berhenti saat idle.** Loop bingkai yang crash dimulai ulang di latar belakang (~5 dtk jeda); tanpa konsumen, aliran berhenti sendiri setelah 5 menit. Penghentian yang disengaja tidak pernah dilawan.

## Persyaratan

- **Node ≥ 24.11.0.**
- **adb**, dari platform-tools Android SDK, diselesaikan dalam urutan ini: variabel lingkungan `ADB` → `adb` di `PATH` → `<ANDROID_HOME>`/`<ANDROID_SDK_ROOT>`/akar SDK bawaan per OS + `/platform-tools/adb`. Pasang dengan `sdkmanager "platform-tools"`, dengan Android Studio, atau dengan `brew install --cask android-platform-tools`. Tanpa adb, plugin tetap dimuat dan ke-20 alat terdaftar; setiap panggilan lalu menjelaskan apa yang kurang.
- **Sebuah perangkat**: emulator produk apa pun, atau ponsel dengan USB debugging aktif. Peluncur `emulator` bersifat opsional dan hanya `android_boot`-lewat-nama-AVD yang membutuhkannya — selebihnya bekerja dengan apa pun yang bisa dilihat adb.
- **DSH ≥ 0.1.0-rc.6 dengan bundel web** untuk panel. Profil headless juga bekerja: ke-20 alat berfungsi normal, hanya tanpa tampilan langsung.
- **Host macOS untuk OCR** (hanya `android_find_text` / `android_tap_text` / `android_wait_for` yang membutuhkannya): plugin mengompilasi `assets/ocr.swift` bawaannya dengan `swiftc` pada pemakaian pertama ke `~/Library/Caches/dsh-android/bin/ocr`. Pada host Linux dan Windows, ketiga alat itu melaporkan bahwa OCR membutuhkan framework Vision macOS; 17 alat lainnya tidak terpengaruh. Penimpaan: `DSH_ANDROID_OCR_DIR`, `DSH_ANDROID_OCR_SWIFT`, `DSH_ANDROID_SWIFTC`.
- **ADBKeyboard** (opsional, untuk masukan CJK dan emoji): `adb shell input text` hanya mendukung ASCII. Pasang [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) di perangkat dan pilih sebagai IME aktif, maka teks non-ASCII dikirim melalui antarmuka broadcast-nya. Tanpanya, pengetikan non-ASCII DITOLAK beserta petunjuk pemasangan — tidak pernah salah ketik secara diam-diam.

## Perangkat fisik

Tidak ada padanan WebDriverAgent yang harus dibangun, ditandatangani, dipercaya, atau ditandatangani ulang setiap tujuh hari. Aktifkan USB debugging, colokkan ponselnya, terima permintaan otorisasi di perangkat, dan ia muncul di `android_devices` dengan setiap alat bekerja terhadapnya. Perangkat yang tidak terotorisasi dilaporkan apa adanya beserta petunjuk permintaannya, bukan sebagai kegagalan misterius.

Tiga catatan jujur:

- **Laju bingkai lebih rendah lewat USB** — kira-kira 2–5 fps pada ponsel dibanding 5–10 fps pada emulator, karena setiap bingkai melintasi tautan USB sebagai PNG utuh.
- **Pengetikan CJK butuh ADBKeyboard** (lihat di atas); ini berlaku sama untuk emulator maupun ponsel.
- **`android_shutdown` tidak dapat mematikan daya ponsel.** adb tidak punya kata kerja semacam itu; alat mengatakannya terus terang alih-alih berpura-pura.

## Performa

Diukur pada emulator (Android 14, 1080×2400):

| | |
| --- | --- |
| Loop screencap persisten | ≈ 8 fps |
| Bingkai pertama `ensureStreaming` | ~200 ms |
| Perjalanan pulang-pergi `input tap` | ~130 ms |

Satu proses anak persisten itulah yang membelinya: memunculkan satu `adb` per bingkai memakan ~50–100 ms sebelum ada piksel yang bergerak. Harapkan ~5–10 fps pada emulator dan ~2–5 fps pada ponsel USB, tergantung mesin dan kerapatan layarnya.

## Pasang di DSH

```sh
dsh plugin --profile web add @zseven-w/dsh-android@latest
dsh web
```

Atau tambahkan sebagai dependensi paket profil yang sudah ada:

```sh
pnpm add @zseven-w/dsh-android
```

## Mulai cepat

1. **Temukan perangkat** — “Cantumkan perangkat Android.” → `android_devices`.
2. **Mulai aliran** — “Alirkan emulator-5554.” → `android_boot`. Panel terbuka dengan perangkat tampil langsung. (Nama AVD akan mem-boot emulator itu lebih dulu.)
3. **Ketuk pada video** — ketuk atau seret langsung pada panel, atau biarkan agen yang menggerakkan: “Buka Pengaturan, lalu ketuk Display.” → `android_interact`, atau `android_ui_tree` + `android_tap_element` untuk ketukan berbasis identitas, atau `android_find_text` + `android_tap_text` saat pohonnya buta.
4. **Build dan jalankan aplikasi Anda** — “Build dan jalankan /path/to/MyApp.” → `android_build_run`. Build Gradle penuh memakan waktu beberapa menit; saat selesai, aplikasi diluncurkan dan Anda menontonnya langsung di panel.
5. **Baca log** — “Tampilkan dua menit terakhir logcat untuk com.example.app.” → `android_logs`.

## Pemecahan masalah

- **Semua alat mengatakan adb tidak tersedia** — pesan errornya menyebutkan ketiga tingkat resolusi. Setel `ADB=/path/to/adb`, taruh `adb` di `PATH`, atau pasang platform-tools SDK (`sdkmanager "platform-tools"`).
- **Perangkat berstatus `unauthorized`** — terima permintaan USB debugging di layar perangkat. `android_devices` melaporkan statusnya secara jujur alih-alih menyembunyikan perangkatnya.
- **`android_boot` tidak menemukan AVD** — peluncur `emulator` tidak dapat ditemukan. Jalankan emulator dengan cara apa pun; ia muncul di `android_devices` begitu adb melihatnya, dan `android_boot` lalu memakai serialnya.
- **Teks non-ASCII ditolak** — pasang ADBKeyboard dan pilih sebagai metode masukan (lihat Persyaratan). Penolakan itu disengaja: `input text` akan membuang atau merusak karakternya secara diam-diam.
- **`android_find_text` mengatakan OCR tidak tersedia** — OCR butuh host macOS (framework Vision milik Apple). Ke-17 alat non-OCR bekerja di mana saja.
- **Aliran berhenti sendiri** — itu kebijakan idle, bukan crash: tanpa konsumen (panel tertutup, tidak ada kartu terpasang, tidak ada rute aktif) aliran berhenti setelah 5 menit dan dimulai ulang pada panggilan alat berikutnya atau saat panel dibuka. Loop yang crash dimulai ulang sendiri dalam ~5 detik.
- **Rotasi tampak salah di launcher** — launcher dan Pengaturan mengunci dirinya ke potret dan mengabaikan `user_rotation`. Itu perilaku normal Android, bukan bug plugin; putarlah di dalam aplikasi yang mengizinkannya.

## Pengembangan

```sh
pnpm install
pnpm run build      # host tsc + client bundle → lib/
pnpm run typecheck
pnpm test           # every static suite; no device required
```

Pengujian asap di `scripts/` melatih `lib/` yang telah dibangun. Semuanya statis kecuali `dev-emulator-smoke.mjs`, yang butuh perangkat dan melaporkan SKIP (exit 0) saat tidak ada.

| Skrip | Cakupannya |
| --- | --- |
| `node scripts/dev-adb-smoke.mjs` | Resolusi adb (env / PATH / SDK) terhadap biner shim, penguraian `devices -l`, `exec-out` yang aman untuk biner, pemecah bingkai PNG beserta resinkronisasinya, escaping input-text, dan siklus hidup host (aliran, kontrol, berhenti saat idle, dispose) terhadap toolchain palsu. |
| `node scripts/dev-routes-static-smoke.mjs` | Rute bertanda tangan terhadap host palsu: grant relatif, token kedaluwarsa/palsu/lintas-jenis, pagar loopback, amplop 405/415/400, penolakan perangkat berkode, validasi `/control`, bentuk rotasi, pembendungan tangkapan layar, dan aliran multipart langsung. |
| `node scripts/dev-tools-smoke.mjs` | Alat inti terhadap host palsu melalui seam `createAndroidTools`. |
| `node scripts/dev-uitree-smoke.mjs` | Alat pohon UI dan baris: penguraian XML `uiautomator`, selektor, pembatasan kedalaman, heuristik baris dan penghitung. |
| `node scripts/dev-logs-smoke.mjs` | snapshot/follow `android_logs`, filter, batas, dan pemungutan proses. |
| `node scripts/dev-panel-smoke.mjs` | Komponen panel, mode ukuran, gaya bingkai, logika dok/pemicu/kapsul (SSR saja). |
| `node scripts/dev-emulator-smoke.mjs [serial]` | Perangkat langsung: bingkai pertama, laju bingkai berkelanjutan, perjalanan pulang-pergi ketukan, dispose. |

## Pemecahan masalah
### Aliran kosong / putih pada emulator

Jika panel mengalirkan gambar putih (atau hitam) polos sementara `android_ui_tree`
masih melihat elemen UI sungguhan, pembacaan balik framebuffer GPU-host milik emulator
rusak di mesin Anda (masalah gfxstream yang dikenal pada sebagian host macOS —
`screencap` sendiri mengembalikan bingkai kosong, sehingga setiap alat layar terpengaruh).
Luncurkan ulang emulator dengan perenderan perangkat lunak:

```bash
emulator -avd <name> -gpu swiftshader_indirect
```

atau setel `hw.gpu.mode=swiftshader_indirect` di `config.ini` milik AVD tersebut. Perangkat
fisik tidak pernah terpengaruh.

## Peta jalan

- **Sumber dengan laju bingkai lebih tinggi.** Seam `StreamSource` sengaja dibuat dapat dicolok: jalur `scrcpy-server` + WebCodecs H.264 dapat menggantikan aliran PNG per bingkai tanpa menyentuh rute, alat, maupun panel.
- **Muat ulang panas pratinjau Compose.** Kembaran iOS-nya menukar-panas pratinjau SwiftUI sebagai dylib; Compose hari ini tidak punya primitif hot-swap yang setara, jadi ini tetap menjadi rencana masa depan alih-alih fitur yang dikirim tapi rapuh.

## Ekosistem

- [DSH iOS Simulator](https://github.com/ZSeven-W/dsh-ios) — arsitektur yang sama untuk Simulator iOS dan iPhone yang terhubung USB
- [DSH Crew](https://github.com/ZSeven-W/dsh-crew) — delegasikan pekerjaan ke agen DSH dari Claude Code / Codex
- [DSH Noema](https://github.com/ZSeven-W/dsh-noema) — memori jangka panjang untuk DSH
- [DSH OpenPencil](https://github.com/ZSeven-W/dsh-openpencil) — periksa dan edit dokumen desain `.op` di dalam percakapan

## Kredit &amp; lisensi

- [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools) (`adb`) — diselesaikan saat runtime, tidak pernah didistribusikan ulang: lisensi SDK Google tidak mengizinkan pemaketannya.
- [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) — Senzhk — IME opsional di perangkat yang menopang pengetikan non-ASCII (Apache-2.0; tidak dipaketkan).
- Arsitektur dan postur rute dibagi dengan [dsh-ios](https://github.com/ZSeven-W/dsh-ios), yang menjadi asal porting plugin ini.
- Lihat [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) untuk pemberitahuan lengkap.

**Lisensi**: MIT
