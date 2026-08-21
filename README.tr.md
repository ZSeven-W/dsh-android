<p align="center">
  <img src="./docs/images/dsh-android-logo.png" alt="DSH Android" width="120" />
</p>

<h1 align="center">DSH Android</h1>

<p align="center">
  <strong>Bir <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> sohbetinin içinde canlı bir Android cihazı — emülatör ya da USB telefon, tamamen adb üzerinden sürülür.</strong><br />
  <sub>20 ajan aracı &bull; süreç içi canlı akış, harici yardımcı yok &bull; üç düğmeli gezinme paneli &bull; Gradle derleme &amp; çalıştırma &bull; Vision OCR</sub>
</p>

<p align="center">
  <sub>npm: <code>@zseven-w/dsh-android</code> &middot; Güncel eklenti sürümü: <code>0.1.0-rc.1</code> &middot; DSH <code>0.1.1-rc.1</code> ile test edildi</sub>
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <b>Türkçe</b> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

<br />

<p align="center">
  <img src="./docs/images/dsh-android-overview.png" alt="DSH Android — sohbetin içinde canlı bir Android cihazı" width="100%" />
</p>
<p align="center"><sub>Bir DSH sohbetinin içinden akıtılan ve yönetilen bir Android cihazı — ortada ajanın araç çağrısı, sağda canlı cihaz paneli</sub></p>

## Neden DSH Android

DSH Android ajana sohbetin içinde gerçek bir Android cihazı verir — ve size pikselleri. Ajan bir emülatörde veya USB ile bağlı bir telefonda akış başlatabilir, bir Gradle projesini derleyip kurabilir, arayüzü `resource-id`/metin ile ya da OCR ile yönetebilir, logcat okuyabilir, süreçleri ve belleği inceleyebilir; bu sırada cihazın canlı akışı kalıcı bir kenar çubuğu panelinde görüntülenir ve videonun üzerinde doğrudan dokunabilir, sürükleyebilir, döndürebilir ve Back / Home / Recents tuşlarına basabilirsiniz. Görüntü bloğu yok, ekran kaydı dosyası yok: görsel baytlar arayüze yalnızca DSH web sunucusunun sunduğu imzalı, süresi dolan URL'ler üzerinden ulaşır.

Tek bir kod yolu vardır. `adb devices -l` bir **seri numarası** bildirir ve bir cihazın yegâne kimliği o seri numarasıdır — `emulator-5554`, bir USB seri numarası veya bir `ip:port` hedefi tamamen aynı şekilde davranır. Eklenti hiçbir emülatör ürününe (AVD, Genymotion, WSA, bulut cihaz çiftliği) bağlı değildir ve akıl yürütmeniz gereken bir simülatör/gerçek cihaz ayrımı yoktur.

| | |
| --- | --- |
| 📱 **Sohbetin içinde canlı cihaz** | **Süreç içinde** üretilen ve en son kare arabelleğinden doğrudan imzalı `/_dsh/dsh-android/*` rotaları üzerinden sunulan bir `multipart/x-mixed-replace` PNG akışı. |
| 🔌 **Harici akış yardımcısı yok, iç bağlantı noktası yok** | Kalıcı tek bir `adb exec-out` alt süreci `while :; do screencap -p; done` çalıştırır; ana makine art arda gelen PNG'leri karelere kendisi ayırır. Vekillenecek bir loopback akış sunucusu, yönetilecek bir bağlantı noktası aralığı ve zarif olmayan bir çıkıştan sonra evlat edinilecek hiçbir şey yoktur. |
| 🧩 **Tek bir adb kod yolu** | Emülatörler ve telefonlar hem adb için hem de bu eklenti için aynı şeydir. `simctl`/WebDriverAgent ikili yığını yok, fiziksel bir cihaz çalışmadan önce derleme ve güven dansı yok. |
| 🛠️ **20 ajan aracı** | Cihazlar, başlatma/kapatma, ekran görüntüsü, etkileşim, Gradle derleme &amp; çalıştırma, uygulama listeleme/başlatma, `uiautomator` UI ağacı + öğeye dokunma, liste/akış satırı eylemleri, Vision OCR bul/dokun/bekle, logcat, süreçler, ANR/çökme backtrace'i, meminfo, uygulama bilgisi. |
| 👆 **Üç düğmeli gezinme paneli** | Canlı videoda dokunun ve sürükleyin; **◁ Back · ○ Home · □ Recents** ile birlikte döndürme, ekran görüntüsü ve yenileme içeren bir araç çubuğu; bildirim gölgesi, hızlı ayarlar, kilitleme, uyandırma ve asistan için bir cihaz menüsü. |
| 🔐 **Yalnızca loopback imzalı rotalar** | Her rota, herhangi bir yetenek denetlenmeden önce loopback bir eş, loopback bir `Host` (DNS yeniden bağlama reddedilir) ve Fetch-Metadata/Origin denetimleri ister. HMAC-SHA256 yeteneklerinin süresi 10 dakika içinde dolar. |
| 🔍 **Anlamsal + görsel otomasyon** | `android_ui_tree` `uiautomator` hiyerarşisini döker, `android_tap_element` ise `resource-id`, metin veya içerik açıklamasına göre dokunur; ağaç boşken veya metin bir görselin içine gömülüyken `android_find_text` / `android_tap_text` koordinat tahmin etmek yerine ekranı OCR'lar. |

## Araçlar

20 aracın tamamı her ana makinede kayıtlıdır ve düz JSON döndürür — görsel baytlar arayüze yalnızca `presentationMeta` + imzalı rotalar üzerinden ulaşır, asla görüntü bloğu olarak dönmez. adb çözümlenemediğinde araçlar kayıtlı kalır ve her çağrı, çözümü adıyla söyleyen açıklayıcı bir hatayla başarısız olur.

Koordinatlar her yerde **akıtılan karenin 0..1 aralığında normalleştirilmiş** değerleridir. Kare, ekran dönüşünü izler (yatay bir uygulama, 1080×2400 bir cihazda 2400×1080 olarak akar) ve `input tap` da aynı uzayı paylaşır; bu yüzden bu eklentinin hiçbir yerinde istemci tarafı döndürme hesabı yoktur.

### Temel araçlar

| Araç | Ne yapar | Temel parametreler |
| --- | --- | --- |
| `android_devices` | `adb devices -l` komutunun bildirdiği her cihazı listeler (seri numarası, durum, emülatör/fiziksel, model, Android sürümü, API seviyesi, AVD adı) ve ayrıca makinedeki AVD adlarını `avds` altında verir. Diğer araçların aldığı seri numarasını keşfetmek için bunu kullanın. Başarısız bir sayım boş liste döndürmek yerine hata fırlatır. | — |
| `android_boot` | Canlı akışı başlatır. Doğrudan akıtmak için ONLINE bir seri numarası verin ya da önce o emülatörü başlatıp açılışı bitince akıtmak için bir AVD adı verin (soğuk başlangıçta dakikalar sürer). Akış sohbet boyunca canlı kalır, böylece panel cihazı canlı gösterebilir. | `device` (zorunlu — bir seri numarası veya AVD adı) |
| `android_shutdown` | Bir emülatörü kapatır (`adb emu kill`) ve akış o cihazı hedefliyorsa akışı durdurur. Fiziksel bir cihaz gerekçesiyle birlikte reddedilir: adb bir telefonun gücünü kesemez. | `device` |
| `android_screenshot` | Bir PNG yakalar ve kısa bir JSON özeti döndürür (yol, bayt, boyutlar, cihaz); görüntü kartta ve panelde işlenir, asla görüntü bloğu olarak dönmez. | `device` (isteğe bağlı — akıştaki cihaz, yoksa çevrimiçi olan tek cihaz) |
| `android_interact` | Akıştaki cihazla etkileşir: 0..1 normalleştirilmiş koordinatlarda dokunma, metin yazma, bir gezinme veya donanım düğmesine basma (`back`, `home`, `recents`, `power`, `volume_up`, `volume_down`, `menu`, `enter`, `delete`), kaydırma hareketi gönderme veya kaydırma. Eylem yerleştikten sonra (~300 ms) taze bir ekran görüntüsü etkiyi gösterir. | `action` (zorunlu — `tap`/`type`/`button`/`gesture`/`scroll`), `x`/`y`, `text`, `name`, `json`, `device` |
| `android_list_apps` | Cihazda kurulu paketleri listeler (`pm list packages`); `dumpsys package` çıktısından sürüm adını ve çözümlenebiliyorsa okunabilir bir etiketi getirir — üçüncü taraf bir paket adı tahmin edilemez, bu yüzden önce listeleyin veya `android_launch_app`'e `name` verin. | `device`, `query` (büyük/küçük harfe duyarsız alt dize, CJK dahil), `include_system` (varsayılan false) |
| `android_launch_app` | Kurulu bir uygulamayı `packageName` ile ya da `name` ile (aynı listeleme üzerinden çözümlenen, büyük/küçük harfe duyarsız etiket alt dizesi) başlatır. İkisinden tam olarak biri. `relaunch` uygulamayı önce zorla durdurur. | `packageName` veya `name` (tam olarak biri), `device`, `relaunch` |
| `android_build_run` | Bir Gradle projesini derler (`./gradlew assembleDebug`), üretilen debug APK'sını kurar (`adb install -r`) ve başlatır. Tam derleme dakikalar sürer; başarısızlıkta sonuç, Gradle hata çıktısının kuyruğunu taşır. | `projectPath` (zorunlu), `device` |

### UI ağacı ve satır araçları (`uiautomator`)

| Araç | Ne yapar | Temel parametreler |
| --- | --- | --- |
| `android_ui_tree` | En öndeki uygulamanın `uiautomator` hiyerarşisini düğümler halinde döker — `type` (sınıf adının son parçası), `text`, `contentDesc`, `resourceId`, piksel cinsinden `bounds`, `enabled`, `focused` — ~40 KB ile sınırlı (en derin seviyeler budanır ve `truncated` ayarlanır). | `device`, `max_depth`, `filter` (metin/içerik açıklaması/kaynak kimliği üzerinde büyük/küçük harfe duyarsız alt dize) |
| `android_tap_element` | Bir öğeye kimliğine göre dokunur — `resource_id` düğümün `resource-id` değeriyle, `text` ise metniyle veya içerik açıklamasıyla eşleşir. Önce tam eşleşme, sonra büyük/küçük harfe duyarsız alt dize; iç içe yinelemeler tek hedefe indirgenir ve belirsiz bir eşleşme birini seçmek yerine en fazla 8 adayı listeler. Devre dışı öğeler reddedilir. Dokunuş öğenin merkezine iner, ardından ~300 ms sonra bir ekran görüntüsü etkiyi gösterir; `expect_text` / `expect_gone` verirseniz dokunuş ve doğrulaması tek gidiş-dönüş olur. | `device`, `resource_id`, `text`, `expect_text`, `expect_gone` |
| `android_ui_rows` | Bir liste/akış ekranını (`RecyclerView` ve benzerleri) ham ağaç yerine SATIRLAR olarak okur: aynı şekle sahip yinelenen alt öğeler; bir dizin, piksel çerçevesi, toplanmış etiket ve o etiketten ayrıştırılan sayaçlar (sayı + sınıflandırıcı belirteç, Çince veya İngilizce — hiçbir uygulama sözlüğü kodlanmamıştır) taşıyan satırlara dönüşür. Sayaç anahtarları gidiş-dönüş yapar: `android_tap_row.expect_count`'a anahtarı tam listede göründüğü gibi verin. | `device`, `max_depth` |
| `android_tap_row` | Görünür bir satırın içinde göreli konumda dokunur (`index` `android_ui_rows`'tan gelir; `x`/`y` o satırın çerçevesinin kesirleridir, varsayılan 0.5 = merkez). Çerçeve TAZE bir ağaç okumasından gelir, bu yüzden mutlak koordinat tahmin edilmez ve aralık dışı bir dizin kırpılmak yerine BAŞARISIZ olur. `expect_count={key, delta}` ile araç ~800 ms sonra satırı yeniden okur ve sayacın tam olarak ±1 değiştiğini doğrular; bilinmeyen bir anahtar dokunuşu gerçekleşmeden REDDEDER. | `device`, `index` (zorunlu), `x`, `y`, `expect_count` (`{key, delta}`) |

### OCR, günlük ve hata ayıklama araçları

| Araç | Ne yapar | Temel parametreler |
| --- | --- | --- |
| `android_find_text` | GEÇERLİ ekranı, eklentinin derlediği Vision yardımcısıyla OCR'lar (isabetli tanıma, zh-Hans + en-US). UI ağacı boş veya bozulmuşken, grafik olarak çizilen metinler için (rozet sayıları, görsellere gömülü fiyatlar) ya da ekrandakini bağımsızca doğrulamak için kullanın. `{device, size, items:[{text, confidence, rect}]}` döndürür; rect'ler sol üst başlangıçlı **piksel** kutularıdır, güvene göre sıralıdır ve çıktı ~40 KB ile sınırlıdır. Yalnızca macOS ana makine. | `device`, `query` (büyük/küçük harfe duyarsız alt dize), `min_confidence` (varsayılan 0.3) |
| `android_tap_text` | GEÇERLİ ekranı OCR'lar ve en iyi metin eşleşmesinin merkezine dokunur — UI ağacının göremediği metinler için, `android_tap_element` ile aynı tam → içerme → aday listesi kuralları. Eşleşen piksel merkezi kare boyutuna göre normalleştirilir ve dokunuş olarak gönderilir; ~300 ms sonra taze bir ekran görüntüsü etkiyi gösterir. Yalnızca macOS ana makine. | `device`, `query` (zorunlu), `min_confidence`, `expect_text`, `expect_gone` |
| `android_wait_for` | Bir metnin belirmesini veya kaybolmasını bekler; koşul sağlanana ya da süre dolana kadar (varsayılan 8 sn, en çok 60 sn) aynı yakalama + OCR hattını her 600 ms'de bir yoklar. Zaman aşımı normal bir `matched:false` yanıtıdır, asla hata değildir. Yalnızca macOS ana makine. | `device`, `text` (zorunlu), `mode` (`appear`/`disappear`), `timeout_ms`, `min_confidence` |
| `android_logs` | Cihazın günlüğe yazdıklarını okur: `snapshot` (yakın bir pencere üzerinde `logcat -d -v time`, varsayılan 2m) veya `follow` (`duration_seconds` kadar sınırlı canlı yakalama, varsayılan 10, en çok 60 — asla asılı kalan bir akış değil). `bundle_id` (pid'ine çözümlenen Android paket adı) ile tek bir uygulamaya süzün. Çıktı ~300 satır / 30 KB ile sınırlıdır ve daraltma ipucu içerir. | `device`, `mode` (`snapshot`/`follow`), `duration`, `duration_seconds`, `bundle_id`, `grep` |
| `android_processes` | Cihazda çalışan süreçleri (`ps -A`) `{pid, name}` olarak listeler — `android_backtrace` için pid kaynağıdır. | `device`, `filter` (süreç adı üzerinde büyük/küçük harfe duyarsız alt dize) |
| `android_backtrace` | Sürecin yığınlarını dökmesini ister (`kill -3`) ve oluşan ANR izini `/data/anr/` altından okur. Root'lanmamış cihazların çoğu bu dizini reddeder, bu yüzden araç çökme arabelleğine (`logcat -b crash -d`) düşer ve hangi motorun yanıt verdiğini ve neyi göremediğini dürüstçe bildirir. | `device`, `pid` veya `bundle_id` |
| `android_meminfo` | `dumpsys meminfo <package>` çıktısını ayrıştırır: toplam PSS, Java/native/grafik dağılımı ve en büyük kategoriler — sızıntı özetinin Android'deki karşılığı. | `device`, `bundle_id` (zorunlu) |
| `android_app_info` | `dumpsys package <package>` üzerinden kurulu uygulama bilgileri: sürüm adı ve kodu, veri dizini, kod yolu, ilk kurulum zamanı ve sistem bayrağı. Eksik bir uygulama hata fırlatmaz; `installed: false` ve `android_list_apps`'i işaret eden bir not döner. | `device`, `bundle_id` (zorunlu) |

## Görüntüleme yüzeyleri

- **Kenar çubuğu paneli.** Canlı görünüm kalıcı bir sağ panelde yaşar (sohbeti kenara iten sabit bir dock veya dar görünüm alanlarında ortalanmış bir kaplama). Canlı PNG akışını işler ve video üzerinde doğrudan tıkla-dokun ile sürükle-hareket kabul eder; araç çubuğunda **◁ Back**, **○ Home**, **□ Recents**, döndürme, ekran görüntüsü ve yenileme bulunur. Bir cihaz menüsü beş cihaz düzeyi eylemi çalıştırır (bildirim gölgesi, hızlı ayarlar, kilitleme, uyandırma, asistan). Cihaz seçici her adb cihazını TEK bir listede, türüne göre gruplanmış olarak gösterir; çevrimdışı AVD'ler tıklayınca başlatma yerine `android_boot`'a yönlendiren bir ipucu olarak görünür. Boyut modları ve çerçeve stilleri (çerçevesiz / kenarlık / telefon gövdesi) iOS ikizindeki gibi çalışır; panel en boy oranını karenin kendi doğal boyutundan uyarlar, bu yüzden bir döndürme hiçbir yapılandırma gerektirmez.
- **Kompakt sohbet kartları.** Araç sonuçları satır içi görsel olmadan tek satırlık kartlar olarak işlenir: cihaz adı, bir eylem alt etiketi, bir durum rozeti ve bir “kenar çubuğunda aç” ipucu. Satıra tıklamak paneli açar.
- **Girişin üstünde durum kapsülü.** Panel kapalıyken ve bir akış çevrimiçiyken, besteleyicinin üstünde küçük bir hap belirir ve tıklanınca paneli açar.
- **Standart mod ve Code Modu.** Standart oturumlar ana makinenin yansıttığı `presentationMeta`'yı kullanır; iç içe Code Modu gönderimleri meta taşımaz, bu yüzden istemci aynı meta'yı kalıcı sonuç JSON'undan yeniden kurar — panel, kartlar ve kapsül her iki modda da çalışır.

## Güvenlik

- **Tarayıcı asla adb ile konuşmaz ve konuşulacak bir iç bağlantı noktası da yoktur.** Akış bu süreçte üretilir ve bellekten sunulur; her bayt, DSH web sunucusu kaynağından eklentiye ait `/_dsh/dsh-android/*` rotaları üzerinden geçer: `/stream/<token>` (canlı multipart PNG), `/screenshot/<token>` (önbellekli PNG), ayrıca `/grant`, `/switch-device`, `/devices`, `/capture`, `/status`, `/control` ve `/device-action`. Bu, vekillenen bir loopback akış sunucusundan kesinlikle daha küçük bir saldırı yüzeyidir.
- **Herhangi bir yetenek okunmadan önce uygulanan üçlü loopback çiti.** Taşıma eşi bir loopback adresi olmalı, `Host` başlığı loopback bir otorite adlandırmalı (böylece DNS yeniden bağlama yapan bir `Host` reddedilir) ve Fetch-Metadata/`Origin` aynı kaynaktan olmalıdır. Host ve Origin çağıran tarafından denetlenen verilerdir ve asla tek başlarına güvenilmez.
- **Süresi 10 dakika içinde dolan HMAC-SHA256 yetenekleri**; `base64url(payload).base64url(mac)` biçimindedir ve her DSH evine özel 32 baytlık bir anahtarla imzalanır (`<DSH_HOME>/cache/dsh-android/stream-access.key`, mod 0600, atomik oluşturulur). Bir cihaz için üretilen yetenek, başka bir cihaz akış yuvasını aldığı anda çalışmayı bırakır ve bir ekran görüntüsü yeteneği akış rotasına karşı yeniden oynatılamaz.
- **Ekran görüntüsü rotası tam olarak tek bir dizini sunar.** Yollar `lstat` ile yürünür (her sembolik bağlantı reddedilir), bir `realpath` kapsam denetimiyle tamamlanır, `O_NOFOLLOW` ile açılır, boyutla sınırlanır ve okumadan sonra yeniden doğrulanır — böylece üretimle getirme arasında sembolik bağlantıyla değiştirilen bir dosya asla sunulmaz.
- **`/grant` hiçbir şeyi başlatmaz.** Yalnızca zaten çevrimiçi olan bir cihaz için kare döngüsünü başlatır ve akışı başka bir cihazın elinden çekip almayı reddeder (409 `device_busy`). Cihaz değiştirmek açık `/switch-device` hareketini gerektirir; bir AVD'yi başlatmak `android_boot` aracının işidir.
- **Keep-alive ve boşta durdurma.** Çöken bir kare döngüsü arka planda yeniden başlar (~5 sn gecikme); sıfır tüketiciyle akış 5 dakika sonra kendini durdurur. Kasıtlı durdurmalar asla engellenmez.

## Gereksinimler

- **Node ≥ 24.11.0.**
- **adb**, Android SDK platform-tools'tan gelir ve şu sırayla çözümlenir: `ADB` ortam değişkeni → `PATH` üzerindeki `adb` → `<ANDROID_HOME>`/`<ANDROID_SDK_ROOT>`/işletim sistemine göre varsayılan SDK kökü + `/platform-tools/adb`. `sdkmanager "platform-tools"` ile, Android Studio ile veya `brew install --cask android-platform-tools` ile kurun. adb olmadan da eklenti yüklenir ve 20 aracın tamamı kaydolur; o zaman her çağrı neyin eksik olduğunu açıklar.
- **Bir cihaz**: herhangi bir ürünün emülatörü ya da USB hata ayıklaması açık bir telefon. `emulator` başlatıcısı isteğe bağlıdır ve yalnızca `android_boot`'un AVD adıyla çalışan biçimi ona ihtiyaç duyar — geri kalan her şey adb'nin görebildiği her şeyle çalışır.
- **Panel için web paketiyle birlikte DSH ≥ 0.1.0-rc.6**. Başsız (headless) profiller de çalışır: 20 aracın tümü normal çalışır, yalnızca canlı görünüm olmaz.
- **OCR için macOS ana makine** (yalnızca `android_find_text` / `android_tap_text` / `android_wait_for` gerektirir): eklenti, paketli `assets/ocr.swift` dosyasını ilk kullanımda `swiftc` ile `~/Library/Caches/dsh-android/bin/ocr` içine derler. Linux ve Windows ana makinelerinde bu üç araç OCR'ın macOS Vision çerçevesini gerektirdiğini bildirir; diğer 17 araç etkilenmez. Geçersiz kılmalar: `DSH_ANDROID_OCR_DIR`, `DSH_ANDROID_OCR_SWIFT`, `DSH_ANDROID_SWIFTC`.
- **ADBKeyboard** (isteğe bağlı, CJK ve emoji girişi için): `adb shell input text` yalnızca ASCII destekler. Cihaza [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) kurup etkin IME olarak seçin; ASCII dışı metin onun yayın (broadcast) arayüzü üzerinden iletilir. Onsuz ASCII dışı yazma, kurulum ipucuyla birlikte REDDEDİLİR — asla sessizce yanlış yazılmaz.

## Fiziksel cihazlar

Derlenecek, imzalanacak, güvenilecek veya yedi günde bir yeniden imzalanacak bir WebDriverAgent muadili yoktur. USB hata ayıklamasını açın, telefonu takın, cihazdaki yetkilendirme istemini kabul edin; cihaz `android_devices` içinde görünür ve her araç onun üzerinde çalışır. Yetkilendirilmemiş bir cihaz gizemli bir hata olarak değil, istem ipucuyla birlikte olduğu gibi bildirilir.

Üç dürüst uyarı:

- **USB üzerinden kare hızı daha düşüktür** — bir telefonda kabaca 2–5 fps, emülatörde 5–10 fps; çünkü her kare USB bağlantısını tam bir PNG olarak geçer.
- **CJK yazımı ADBKeyboard gerektirir** (yukarıya bakın); bu, emülatörleri ve telefonları aynı şekilde etkiler.
- **`android_shutdown` bir telefonun gücünü kesemez.** adb'de böyle bir fiil yoktur; araç numara yapmak yerine bunu söyler.

## Performans

Bir emülatörde ölçüldü (Android 14, 1080×2400):

| | |
| --- | --- |
| Kalıcı screencap döngüsü | ≈ 8 fps |
| `ensureStreaming` ilk kare | ~200 ms |
| `input tap` gidiş-dönüşü | ~130 ms |

Bunu mümkün kılan şey tek kalıcı alt süreçtir: kare başına bir `adb` başlatmak, tek bir piksel kıpırdamadan önce ~50–100 ms'e mal olur. Makineye ve ekran yoğunluğuna bağlı olarak emülatörde ~5–10 fps, USB telefonda ~2–5 fps bekleyin.

## DSH'ye Kurulum

```sh
dsh plugin --profile web add @zseven-w/dsh-android@latest
dsh web
```

Ya da mevcut bir profil paketinin bağımlılığı olarak ekleyin:

```sh
pnpm add @zseven-w/dsh-android
```

## Hızlı başlangıç

1. **Cihazları keşfedin** — “Android cihazlarını listele.” → `android_devices`.
2. **Akışı başlatın** — “emulator-5554'ü akıt.” → `android_boot`. Panel, cihaz canlıyken açılır. (Bir AVD adı verildiğinde önce o emülatör başlatılır.)
3. **Videoda dokunun** — panelde doğrudan dokunun veya sürükleyin; ya da ajanın yönetmesine izin verin: “Ayarlar'ı aç, sonra Display'e dokun.” → `android_interact`, ya da kimlik tabanlı dokunuşlar için `android_ui_tree` + `android_tap_element`, ya da ağaç kör olduğunda `android_find_text` + `android_tap_text`.
4. **Uygulamanızı derleyip çalıştırın** — “/path/to/MyApp'i derleyip çalıştır.” → `android_build_run`. Tam bir Gradle derlemesi dakikalar sürer; tamamlandığında uygulama başlar ve onu panelde canlı izlersiniz.
5. **Günlükleri okuyun** — “com.example.app için logcat'in son iki dakikasını göster.” → `android_logs`.

## Sorun giderme

- **Her araç adb'nin kullanılamadığını söylüyor** — hata, üç çözümleme katmanını adıyla verir. `ADB=/path/to/adb` ayarlayın, `adb`'yi `PATH` üzerine koyun ya da SDK platform-tools'u kurun (`sdkmanager "platform-tools"`).
- **Cihaz `unauthorized` durumunda** — cihaz ekranındaki USB hata ayıklama istemini kabul edin. `android_devices` cihazı gizlemek yerine durumu dürüstçe bildirir.
- **`android_boot` bir AVD bulamıyor** — `emulator` başlatıcısı keşfedilemedi. Emülatörü herhangi bir yolla başlatın; adb onu görür görmez `android_devices` içinde belirir ve `android_boot` da seri numarasını alır.
- **ASCII dışı metin reddediliyor** — ADBKeyboard'ı kurup giriş yöntemi olarak seçin (bkz. Gereksinimler). Bu reddediş bilinçlidir: `input text` karakterleri sessizce düşürür ya da bozardı.
- **`android_find_text` OCR'ın kullanılamadığını söylüyor** — OCR bir macOS ana makine gerektirir (Apple'ın Vision çerçevesi). OCR dışındaki 17 araç her yerde çalışır.
- **Akış kendiliğinden duruyor** — bu boşta politikasıdır, çökme değil: sıfır tüketiciyle (panel kapalı, bağlı kart yok, etkin rota yok) akış 5 dakika sonra durur ve bir sonraki araç çağrısında veya panel açılışında yeniden başlar. Çöken bir döngü ~5 saniye içinde kendiliğinden yeniden başlar.
- **Başlatıcıda döndürme yanlış görünüyor** — başlatıcılar ve Ayarlar kendilerini dikey moda sabitler ve `user_rotation`'ı yok sayar. Bu, eklenti hatası değil, normal Android davranışıdır; buna izin veren bir uygulamanın içinde döndürün.

## Geliştirme

```sh
pnpm install
pnpm run build      # host tsc + client bundle → lib/
pnpm run typecheck
pnpm test           # every static suite; no device required
```

`scripts/` altındaki duman testleri derlenmiş `lib/` çıktısını sınar. `dev-emulator-smoke.mjs` dışındakilerin tamamı statiktir; o ise bir cihaz gerektirir ve cihaz yokken SKIP (çıkış kodu 0) bildirir.

| Betik | Neyi kapsar |
| --- | --- |
| `node scripts/dev-adb-smoke.mjs` | adb çözümlemesi (env / PATH / SDK) bir shim ikilisine karşı, `devices -l` ayrıştırma, ikili güvenli `exec-out`, PNG kare ayırıcısı ve yeniden senkronizasyonu, input-text kaçışlama ve sahte bir araç zincirine karşı ana makine yaşam döngüsü (akış, kontrol, boşta durdurma, dispose). |
| `node scripts/dev-routes-static-smoke.mjs` | İmzalı rotalar sahte bir ana makineye karşı: göreli grant'ler, süresi dolmuş/sahte/çapraz türde belirteçler, loopback çiti, 405/415/400 zarfları, kodlu cihaz reddetmeleri, `/control` doğrulaması, döndürme şekli, ekran görüntüsü kapsamı ve canlı multipart akışı. |
| `node scripts/dev-tools-smoke.mjs` | Temel araçlar, `createAndroidTools` dikişi üzerinden sahte bir ana makineye karşı. |
| `node scripts/dev-uitree-smoke.mjs` | UI ağacı ve satır araçları: `uiautomator` XML ayrıştırma, seçiciler, derinlik sınırlama, satır ve sayaç sezgileri. |
| `node scripts/dev-logs-smoke.mjs` | `android_logs` snapshot/follow, filtreler, sınırlar ve süreç toplama. |
| `node scripts/dev-panel-smoke.mjs` | Panel bileşenleri, boyut modları, çerçeve stilleri, dock/tetikleyici/kapsül mantığı (yalnızca SSR). |
| `node scripts/dev-emulator-smoke.mjs [serial]` | Canlı cihaz: ilk kare, sürdürülen kare hızı, dokunuş gidiş-dönüşü, dispose. |

## Sorun giderme
### Emülatörde boş / beyaz akış

Panel düz beyaz (veya siyah) bir görüntü akıtırken `android_ui_tree` hâlâ gerçek
arayüz öğelerini görüyorsa, emülatörün ana makine GPU'sundaki kare arabelleği geri
okuması sizin makinenizde bozuktur (bazı macOS ana makinelerinde bilinen bir
gfxstream sorunu — `screencap` kendisi boş kareler döndürür, bu yüzden tüm ekran
araçları etkilenir). Emülatörü yazılımsal işlemeyle yeniden başlatın:

```bash
emulator -avd <name> -gpu swiftshader_indirect
```

ya da AVD'nin `config.ini` dosyasında `hw.gpu.mode=swiftshader_indirect`
ayarlayın. Fiziksel cihazlar asla etkilenmez.

## Yol haritası

- **Daha yüksek kare hızlı bir kaynak.** `StreamSource` dikişi bilinçli olarak takılabilir bırakıldı: bir `scrcpy-server` + WebCodecs H.264 yolu, rotalara, araçlara veya panele dokunmadan kare başına PNG akışının yerini alabilir.
- **Compose önizleme sıcak yeniden yükleme.** iOS ikizi SwiftUI önizlemelerini dylib olarak sıcak değişimle uygular; Compose'un bugün eşdeğer bir sıcak değişim ilkeli yok, bu yüzden bu, gönderilmiş-ama-titrek bir özellik olmak yerine gelecek bir madde olarak kalıyor.

## Ekosistem

- [DSH iOS Simulator](https://github.com/ZSeven-W/dsh-ios) — iOS Simülatörü ve USB ile bağlı iPhone'lar için aynı mimari
- [DSH Crew](https://github.com/ZSeven-W/dsh-crew) — Claude Code / Codex üzerinden DSH ajanlarına iş dağıtın
- [DSH Noema](https://github.com/ZSeven-W/dsh-noema) — DSH için uzun süreli bellek
- [DSH OpenPencil](https://github.com/ZSeven-W/dsh-openpencil) — `.op` tasarım belgelerini sohbet içinde inceleyin ve düzenleyin

## Teşekkürler &amp; lisans

- [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools) (`adb`) — çalışma zamanında çözümlenir, asla yeniden dağıtılmaz: Google'ın SDK lisansı paketlemeye izin vermiyor.
- [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) — Senzhk — ASCII dışı yazmanın arkasındaki isteğe bağlı cihaz üstü IME (Apache-2.0; paketlenmez).
- Mimari ve rota duruşu, bu eklentinin kendisinden taşındığı [dsh-ios](https://github.com/ZSeven-W/dsh-ios) ile paylaşılır.
- Bildirimlerin tamamı için [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) dosyasına bakın.

**Lisans**: MIT
