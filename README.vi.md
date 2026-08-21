<p align="center">
  <img src="./docs/images/dsh-android-logo.png" alt="DSH Android" width="120" />
</p>

<h1 align="center">DSH Android</h1>

<p align="center">
  <strong>Một thiết bị Android trực tiếp ngay trong cuộc hội thoại <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> — trình giả lập hoặc điện thoại cắm USB, điều khiển hoàn toàn qua adb.</strong><br />
  <sub>20 công cụ agent &bull; luồng trực tiếp ngay trong tiến trình, không cần trình hỗ trợ bên ngoài &bull; bảng điều hướng ba nút &bull; build &amp; chạy Gradle &bull; Vision OCR</sub>
</p>

<p align="center">
  <sub>npm: <code>@zseven-w/dsh-android</code> &middot; Bản phát hành plugin hiện tại: <code>0.1.0-rc.3</code> &middot; Đã kiểm thử với DSH <code>0.1.1-rc.1</code></sub>
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <b>Tiếng Việt</b> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

<br />

<p align="center">
  <img src="./docs/images/dsh-android-overview.png" alt="DSH Android — thiết bị Android trực tiếp ngay trong cuộc hội thoại" width="100%" />
</p>
<p align="center"><sub>Một thiết bị Android được truyền hình ảnh và điều khiển ngay trong cuộc hội thoại DSH — lệnh gọi công cụ của agent ở chính giữa, bảng thiết bị trực tiếp ở bên phải</sub></p>

## Vì sao chọn DSH Android

DSH Android trao cho agent một thiết bị Android thật ngay trong cuộc hội thoại — và trao cho bạn các pixel. Agent có thể khởi động luồng trên trình giả lập hoặc trên điện thoại cắm USB, build và cài đặt một dự án Gradle, điều khiển UI theo `resource-id`/văn bản hoặc bằng OCR, đọc logcat, kiểm tra tiến trình và bộ nhớ, trong khi luồng trực tiếp của thiết bị hiển thị trong một bảng bên cố định nơi bạn có thể chạm, kéo, xoay và bấm Back / Home / Recents ngay trên video. Không có khối ảnh, không có tệp ghi màn hình: các byte hình ảnh chỉ đến được UI qua những URL có chữ ký và hết hạn do máy chủ web DSH cung cấp.

Chỉ tồn tại đúng một đường mã. `adb devices -l` báo cáo một **serial**, và serial đó là danh tính duy nhất của một thiết bị — `emulator-5554`, một serial USB hay một đích `ip:port` đều hoạt động y hệt nhau. Plugin không gắn với bất kỳ sản phẩm giả lập nào (AVD, Genymotion, WSA, một trang trại thiết bị trên đám mây), và không có sự phân đôi giả lập/thiết bị thật nào phải bận tâm.

| | |
| --- | --- |
| 📱 **Thiết bị trực tiếp trong hội thoại** | Một luồng PNG `multipart/x-mixed-replace` được tạo **ngay trong tiến trình** và phục vụ thẳng từ bộ đệm khung hình mới nhất qua các tuyến `/_dsh/dsh-android/*` có chữ ký. |
| 🔌 **Không có trình hỗ trợ luồng bên ngoài, không có cổng nội bộ** | Một tiến trình con `adb exec-out` thường trú chạy `while :; do screencap -p; done`; máy chủ tự tách chuỗi PNG nối liền thành từng khung hình. Không có máy chủ luồng loopback nào phải proxy, không có dải cổng nào phải quản lý, và không còn gì phải tiếp quản sau một lần thoát bất thường. |
| 🧩 **Một đường mã adb duy nhất** | Với adb và với plugin này, trình giả lập và điện thoại là cùng một thứ. Không có ngăn xếp kép `simctl`/WebDriverAgent, không có màn build-và-tin-cậy trước khi một thiết bị vật lý chịu chạy. |
| 🛠️ **20 công cụ agent** | Thiết bị, khởi động/tắt máy, ảnh chụp màn hình, tương tác, build &amp; chạy Gradle, liệt kê/khởi chạy ứng dụng, cây UI `uiautomator` + chạm theo phần tử, thao tác hàng danh sách/bảng tin, tìm/chạm/chờ văn bản bằng Vision OCR, logcat, tiến trình, backtrace ANR/sự cố, meminfo, thông tin ứng dụng. |
| 👆 **Bảng điều hướng ba nút** | Chạm và kéo trên video trực tiếp; một thanh công cụ với **◁ Back · ○ Home · □ Recents** cùng xoay, chụp màn hình và làm mới; một trình đơn thiết bị cho bảng thông báo, cài đặt nhanh, khóa, đánh thức và trợ lý. |
| 🖼️ **Đa phương thức nguyên bản** | Trên một mô hình xử lý được hình ảnh, mọi công cụ chụp (screenshot, interact, tap_element, tap_text, tap_row) trả về CHÍNH ảnh chụp màn hình dưới dạng một image block — mô hình nhìn thấy màn hình trực tiếp. OCR vẫn được giữ cho các thao tác chạm văn bản chính xác đến từng điểm ảnh và cho các tuyến chỉ có văn bản; các mô hình chỉ xử lý văn bản vẫn nhận bản tóm tắt JSON thuần như trước. |
| 🔐 **Tuyến có chữ ký, chỉ qua loopback** | Mọi tuyến đều đòi hỏi một đầu loopback, một `Host` loopback (tấn công DNS rebinding bị từ chối) và các kiểm tra Fetch-Metadata/Origin — trước khi bất kỳ năng lực nào được xét đến. Năng lực HMAC-SHA256 hết hạn trong vòng 10 phút. |
| 🔍 **Tự động hóa theo ngữ nghĩa + thị giác** | `android_ui_tree` kết xuất cây phân cấp `uiautomator` và `android_tap_element` chạm theo `resource-id`, văn bản hoặc content-description; khi cây rỗng hoặc văn bản đã bị nung vào ảnh, `android_find_text` / `android_tap_text` sẽ OCR màn hình thay vì đoán tọa độ. |

## Công cụ

Cả 20 công cụ đều được đăng ký trên mọi máy chủ và chỉ trả về JSON thuần — các byte hình ảnh chỉ đến được UI qua `presentationMeta` + các tuyến có chữ ký, không bao giờ dưới dạng khối ảnh. Khi không phân giải được adb, các công cụ vẫn được đăng ký và mọi lệnh gọi đều thất bại kèm một lỗi giải thích rõ cách khắc phục.

Tọa độ ở khắp nơi đều được **chuẩn hóa 0..1 theo khung hình đang truyền**. Khung hình đi theo hướng xoay của màn hình (một ứng dụng nằm ngang truyền 2400×1080 trên thiết bị 1080×2400) và `input tap` dùng chung không gian đó, nên trong plugin này không hề tồn tại phép tính xoay nào phía client.

### Công cụ cốt lõi

| Công cụ | Chức năng | Tham số chính |
| --- | --- | --- |
| `android_devices` | Liệt kê mọi thiết bị mà `adb devices -l` báo cáo (serial, trạng thái, giả lập/vật lý, kiểu máy, phiên bản Android, cấp API, tên AVD) cùng danh sách tên AVD của máy dưới khóa `avds`. Dùng nó để tìm ra serial mà các công cụ khác cần. Nếu liệt kê thất bại, công cụ ném lỗi thay vì trả về danh sách rỗng. | — |
| `android_boot` | Khởi động luồng trực tiếp. Truyền một serial đang ONLINE để truyền hình ảnh ngay, hoặc một tên AVD để khởi chạy trình giả lập đó trước rồi truyền hình ảnh khi nó khởi động xong (mất vài phút nếu khởi động nguội). Luồng được duy trì suốt cuộc hội thoại để bảng có thể hiển thị thiết bị trực tiếp. | `device` (bắt buộc — một serial hoặc một tên AVD) |
| `android_shutdown` | Tắt một trình giả lập (`adb emu kill`) và dừng luồng nếu luồng đang nhắm vào thiết bị đó. Thiết bị vật lý sẽ bị từ chối kèm lý do: adb không thể tắt nguồn một chiếc điện thoại. | `device` |
| `android_screenshot` | Chụp một ảnh PNG và trả về bản tóm tắt JSON ngắn gọn (đường dẫn, số byte, kích thước, thiết bị); ảnh hiển thị trong thẻ và trong bảng, không bao giờ dưới dạng khối ảnh. | `device` (tùy chọn — thiết bị đang truyền, nếu không thì thiết bị trực tuyến duy nhất) |
| `android_interact` | Tương tác với thiết bị đang truyền hình ảnh: chạm theo tọa độ chuẩn hóa 0..1, nhập văn bản, bấm một phím điều hướng hoặc phím cứng (`back`, `home`, `recents`, `power`, `volume_up`, `volume_down`, `menu`, `enter`, `delete`), gửi cử chỉ vuốt, hoặc cuộn. Sau khi thao tác lắng xuống (~300 ms), một ảnh chụp mới cho thấy kết quả. | `action` (bắt buộc — `tap`/`type`/`button`/`gesture`/`scroll`), `x`/`y`, `text`, `name`, `json`, `device` |
| `android_list_apps` | Liệt kê các gói đã cài trên thiết bị (`pm list packages`), kèm tên phiên bản lấy từ `dumpsys package` và nhãn dễ đọc khi phân giải được — không thể đoán tên gói của ứng dụng bên thứ ba, vậy nên hãy liệt kê nó hoặc truyền `name` cho `android_launch_app`. | `device`, `query` (chuỗi con không phân biệt hoa thường, hỗ trợ cả CJK), `include_system` (mặc định false) |
| `android_launch_app` | Khởi chạy một ứng dụng đã cài theo `packageName`, hoặc theo `name` (chuỗi con của nhãn, không phân biệt hoa thường, phân giải qua chính danh sách trên). Chỉ được dùng đúng một trong hai. `relaunch` sẽ buộc dừng ứng dụng trước. | `packageName` hoặc `name` (đúng một), `device`, `relaunch` |
| `android_build_run` | Build một dự án Gradle (`./gradlew assembleDebug`), cài đặt tệp APK debug thu được (`adb install -r`) rồi khởi chạy nó. Một lần build đầy đủ mất vài phút; khi thất bại, kết quả kèm theo phần đuôi của thông báo lỗi Gradle. | `projectPath` (bắt buộc), `device` |

### Công cụ cây UI và hàng danh sách (`uiautomator`)

| Công cụ | Chức năng | Tham số chính |
| --- | --- | --- |
| `android_ui_tree` | Kết xuất cây phân cấp `uiautomator` của ứng dụng đang ở tiền cảnh thành các nút — `type` (phần đuôi tên lớp), `text`, `contentDesc`, `resourceId`, `bounds` tính bằng pixel, `enabled`, `focused` — giới hạn ở khoảng 40 KB (các tầng sâu nhất bị cắt tỉa và `truncated` được đặt). | `device`, `max_depth`, `filter` (chuỗi con không phân biệt hoa thường trên text/content-description/resource-id) |
| `android_tap_element` | Chạm một phần tử theo danh tính — `resource_id` khớp với `resource-id` của nút; `text` khớp với văn bản hoặc content-description của nó. Ưu tiên khớp chính xác trước, rồi mới đến chuỗi con không phân biệt hoa thường; các bản trùng lồng nhau gộp lại thành một mục tiêu duy nhất, còn khi khớp mơ hồ công cụ liệt kê tối đa 8 ứng viên thay vì tự chọn. Phần tử bị vô hiệu hóa sẽ bị từ chối. Cú chạm rơi vào tâm phần tử, sau đó ảnh chụp sau ~300 ms cho thấy kết quả; truyền `expect_text` / `expect_gone` và cú chạm cùng phần xác minh của nó gộp thành một vòng gọi duy nhất. | `device`, `resource_id`, `text`, `expect_text`, `expect_gone` |
| `android_ui_rows` | Đọc một màn hình danh sách/bảng tin (`RecyclerView` và họ hàng) theo HÀNG thay vì theo cây thô: các nút con lặp lại cùng hình dạng trở thành những hàng mang chỉ mục, khung pixel, nhãn tổng hợp và các bộ đếm phân tích ra từ nhãn đó (con số + từ định danh, tiếng Trung hay tiếng Anh — không có từ vựng ứng dụng nào bị mã hóa cứng). Khóa bộ đếm dùng lại được nguyên vẹn: truyền đúng một khóa như đã liệt kê vào `android_tap_row.expect_count`. | `device`, `max_depth` |
| `android_tap_row` | Chạm vào một vị trí tương đối bên trong một hàng đang hiển thị (`index` lấy từ `android_ui_rows`; `x`/`y` là tỉ lệ trong khung của hàng đó, mặc định 0.5 = chính giữa). Khung đến từ một lần đọc cây MỚI, nên không có tọa độ tuyệt đối nào bị đoán, và chỉ mục ngoài phạm vi sẽ THẤT BẠI chứ không bị kẹp về biên. Với `expect_count={key, delta}`, công cụ đọc lại hàng sau ~800 ms và xác minh bộ đếm đã dịch đúng ±1; một khóa không xác định sẽ khiến cú chạm BỊ TỪ CHỐI trước khi diễn ra. | `device`, `index` (bắt buộc), `x`, `y`, `expect_count` (`{key, delta}`) |

### Công cụ OCR, nhật ký và gỡ lỗi

| Công cụ | Chức năng | Tham số chính |
| --- | --- | --- |
| `android_find_text` | OCR màn hình HIỆN TẠI bằng trình hỗ trợ Vision do plugin biên dịch (nhận dạng chính xác, zh-Hans + en-US). Dùng nó khi cây UI rỗng hoặc suy biến, khi văn bản được vẽ dưới dạng đồ họa (số huy hiệu, giá nung vào ảnh), hoặc để kiểm chứng độc lập những gì đang hiện trên màn hình. Trả về `{device, size, items:[{text, confidence, rect}]}` trong đó rect là các hộp **pixel** gốc ở góc trên bên trái, sắp theo độ tin cậy và giới hạn ở khoảng 40 KB. Chỉ chạy trên máy chủ macOS. | `device`, `query` (chuỗi con không phân biệt hoa thường), `min_confidence` (mặc định 0.3) |
| `android_tap_text` | OCR màn hình HIỆN TẠI rồi chạm vào tâm của kết quả khớp văn bản tốt nhất — cùng bộ quy tắc chính xác → chứa → danh sách ứng viên như `android_tap_element`, dành cho văn bản mà cây UI không nhìn thấy. Tâm pixel khớp được chuẩn hóa theo kích thước khung rồi gửi đi dưới dạng một cú chạm; sau ~300 ms một ảnh chụp mới cho thấy kết quả. Chỉ chạy trên máy chủ macOS. | `device`, `query` (bắt buộc), `min_confidence`, `expect_text`, `expect_gone` |
| `android_wait_for` | Chờ cho đến khi văn bản xuất hiện hoặc biến mất, thăm dò cùng một quy trình chụp + OCR mỗi 600 ms cho tới khi điều kiện thỏa hoặc hết thời gian chờ (mặc định 8 s, tối đa 60 s). Hết thời gian chờ là một câu trả lời `matched:false` bình thường, không bao giờ là lỗi. Chỉ chạy trên máy chủ macOS. | `device`, `text` (bắt buộc), `mode` (`appear`/`disappear`), `timeout_ms`, `min_confidence` |
| `android_logs` | Đọc những gì thiết bị ghi lại: `snapshot` (`logcat -d -v time` trong một khoảng thời gian gần đây, mặc định 2m) hoặc `follow` (một lần thu trực tiếp có giới hạn theo `duration_seconds`, mặc định 10, tối đa 60 — không bao giờ là một luồng treo vô hạn). Lọc theo một ứng dụng bằng `bundle_id` (tên gói Android, được phân giải sang pid của nó). Đầu ra giới hạn ở khoảng 300 dòng / 30 KB kèm gợi ý thu hẹp. | `device`, `mode` (`snapshot`/`follow`), `duration`, `duration_seconds`, `bundle_id`, `grep` |
| `android_processes` | Liệt kê các tiến trình đang chạy trên thiết bị (`ps -A`) dưới dạng `{pid, name}` — nguồn cung cấp pid cho `android_backtrace`. | `device`, `filter` (chuỗi con không phân biệt hoa thường trên tên tiến trình) |
| `android_backtrace` | Yêu cầu tiến trình kết xuất ngăn xếp của nó (`kill -3`) rồi đọc tệp ANR trace thu được trong `/data/anr/`. Phần lớn thiết bị chưa root từ chối thư mục đó, nên công cụ hạ cấp xuống bộ đệm sự cố (`logcat -b crash -d`) và báo cáo trung thực rằng cơ chế nào đã trả lời cũng như nó không nhìn thấy được những gì. | `device`, `pid` hoặc `bundle_id` |
| `android_meminfo` | Phân tích `dumpsys meminfo <package>`: tổng PSS, phần chia Java/native/đồ họa và các hạng mục lớn nhất — câu trả lời phía Android cho một bản tóm tắt rò rỉ bộ nhớ. | `device`, `bundle_id` (bắt buộc) |
| `android_app_info` | Thông tin về ứng dụng đã cài từ `dumpsys package <package>`: tên và mã phiên bản, thư mục dữ liệu, đường dẫn mã, thời điểm cài đặt lần đầu và cờ hệ thống. Ứng dụng không tồn tại sẽ trả về `installed: false` kèm ghi chú trỏ tới `android_list_apps` — nó không ném lỗi. | `device`, `bundle_id` (bắt buộc) |

## Bề mặt hiển thị

- **Bảng bên.** Khung nhìn trực tiếp nằm trong một bảng cố định bên phải (một khu neo cố định đẩy cuộc hội thoại sang bên, hoặc một lớp phủ căn giữa trên khung nhìn hẹp). Nó kết xuất luồng PNG trực tiếp và nhận thao tác nhấp-để-chạm cùng kéo-để-ra-cử-chỉ ngay trên video, với một thanh công cụ mang **◁ Back**, **○ Home**, **□ Recents**, xoay, chụp màn hình và làm mới. Một trình đơn thiết bị chạy năm hành động cấp thiết bị (bảng thông báo, cài đặt nhanh, khóa, đánh thức, trợ lý). Trình chọn thiết bị liệt kê mọi thiết bị adb trong MỘT danh sách duy nhất, nhóm theo loại, với các AVD ngoại tuyến hiển thị như một gợi ý trỏ tới `android_boot` chứ không phải khởi động khi nhấp. Các chế độ kích thước và kiểu khung (không khung / viền / vỏ điện thoại) hoạt động như ở phiên bản song sinh iOS; bảng tự điều chỉnh tỉ lệ khung hình theo kích thước tự nhiên của chính khung hình, nên một lần xoay không cần cấu hình gì cả.
- **Thẻ hội thoại gọn.** Kết quả công cụ hiển thị dưới dạng thẻ một dòng, không có hình ảnh nội tuyến: tên thiết bị, một nhãn phụ mô tả hành động, một huy hiệu trạng thái và gợi ý "mở trong bảng bên". Nhấp vào dòng đó sẽ mở bảng.
- **Viên trạng thái phía trên ô nhập.** Khi bảng đang đóng mà một luồng vẫn trực tuyến, một viên nhỏ xuất hiện phía trên ô soạn thảo và mở bảng khi được nhấp.
- **Chế độ chuẩn và Code Mode.** Phiên chuẩn dùng `presentationMeta` do máy chủ chiếu xuống; các lệnh điều phối Code Mode lồng nhau không mang theo meta, nên client dựng lại meta y hệt từ JSON kết quả bền vững — bảng, thẻ và viên trạng thái đều hoạt động ở cả hai chế độ.

## Bảo mật

- **Trình duyệt không bao giờ nói chuyện với adb, và cũng chẳng có cổng nội bộ nào để nói chuyện cùng.** Luồng được tạo ngay trong tiến trình này và phục vụ từ bộ nhớ; mọi byte đều băng qua origin của máy chủ web DSH thông qua các tuyến `/_dsh/dsh-android/*` do plugin sở hữu: `/stream/<token>` (luồng PNG multipart trực tiếp), `/screenshot/<token>` (PNG đã lưu đệm), cùng với `/grant`, `/switch-device`, `/devices`, `/capture`, `/status`, `/control` và `/device-action`. Đây là một bề mặt tấn công nhỏ hơn hẳn so với một máy chủ luồng loopback được proxy.
- **Hàng rào loopback ba lớp, áp dụng trước khi đọc bất kỳ năng lực nào.** Đầu kết nối phải là một địa chỉ loopback, tiêu đề `Host` phải nêu một thẩm quyền loopback (nên một `Host` kiểu DNS rebinding sẽ bị từ chối), và Fetch-Metadata/`Origin` phải cùng origin. Host và Origin là dữ liệu do bên gọi kiểm soát và không bao giờ được tin tưởng nếu đứng một mình.
- **Năng lực HMAC-SHA256 hết hạn trong vòng 10 phút**, định dạng `base64url(payload).base64url(mac)` và được ký bằng khóa 32 byte riêng cho từng DSH home (`<DSH_HOME>/cache/dsh-android/stream-access.key`, quyền 0600, tạo ra một cách nguyên tử). Một năng lực đúc cho thiết bị này lập tức mất hiệu lực khi thiết bị khác chiếm khe luồng, và một năng lực ảnh chụp màn hình không thể phát lại trên tuyến luồng.
- **Tuyến ảnh chụp màn hình chỉ phục vụ đúng một thư mục.** Các đường dẫn được duyệt bằng `lstat` (mọi liên kết tượng trưng đều bị từ chối), chốt lại bằng kiểm tra chứa `realpath`, mở bằng `O_NOFOLLOW`, giới hạn kích thước và xác thực lại sau khi đọc — nên một tệp bị tráo thành symlink giữa lúc đúc và lúc lấy sẽ không bao giờ được phục vụ.
- **`/grant` không bao giờ khởi động bất cứ thứ gì.** Nó chỉ khởi động vòng lặp khung hình cho một thiết bị đã trực tuyến, và nó từ chối (409 `device_busy`) việc giật luồng khỏi tay một thiết bị khác. Đổi thiết bị đòi hỏi cử chỉ `/switch-device` tường minh; việc khởi động một AVD vẫn thuộc về công cụ `android_boot`.
- **Duy trì kết nối và dừng khi nhàn rỗi.** Một vòng lặp khung hình bị sập sẽ khởi động lại ở nền (trễ ~5 s); khi không còn bên tiêu thụ nào, luồng tự dừng sau 5 phút. Những lần dừng có chủ ý không bao giờ bị chống lại.

## Yêu cầu

- **Node ≥ 24.11.0.**
- **adb**, từ bộ platform-tools của Android SDK, phân giải theo thứ tự sau: biến môi trường `ADB` → `adb` trên `PATH` → `<ANDROID_HOME>`/`<ANDROID_SDK_ROOT>`/thư mục gốc SDK mặc định của từng hệ điều hành + `/platform-tools/adb`. Cài nó bằng `sdkmanager "platform-tools"`, bằng Android Studio, hoặc bằng `brew install --cask android-platform-tools`. Không có adb thì plugin vẫn nạp được và cả 20 công cụ vẫn đăng ký; mỗi lệnh gọi khi đó sẽ giải thích thứ đang thiếu.
- **Một thiết bị**: một trình giả lập thuộc bất kỳ sản phẩm nào, hoặc một chiếc điện thoại đã bật gỡ lỗi USB. Trình khởi chạy `emulator` là tùy chọn và chỉ `android_boot` theo tên AVD mới cần đến nó — mọi thứ còn lại hoạt động với bất cứ gì adb nhìn thấy.
- **DSH ≥ 0.1.0-rc.6 kèm gói web** để có bảng hiển thị. Hồ sơ headless cũng chạy được: cả 20 công cụ hoạt động bình thường, chỉ là không có khung nhìn trực tiếp.
- **Máy chủ macOS cho OCR** (chỉ `android_find_text` / `android_tap_text` / `android_wait_for` cần đến): ở lần dùng đầu tiên, plugin biên dịch tệp `assets/ocr.swift` đi kèm bằng `swiftc` vào `~/Library/Caches/dsh-android/bin/ocr`. Trên máy chủ Linux và Windows, ba công cụ đó sẽ báo rằng OCR cần framework Vision của macOS; 17 công cụ còn lại không bị ảnh hưởng. Các biến ghi đè: `DSH_ANDROID_OCR_DIR`, `DSH_ANDROID_OCR_SWIFT`, `DSH_ANDROID_SWIFTC`.
- **ADBKeyboard** (tùy chọn, để nhập tiếng CJK và emoji): `adb shell input text` chỉ hỗ trợ ASCII. Hãy cài [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) lên thiết bị và chọn nó làm IME đang dùng, khi đó văn bản ngoài ASCII sẽ được chuyển qua giao diện broadcast của nó. Không có nó, việc nhập ký tự ngoài ASCII sẽ BỊ TỪ CHỐI kèm gợi ý cài đặt — chứ không bao giờ bị gõ sai một cách âm thầm.

## Thiết bị vật lý

Không có thứ gì tương đương WebDriverAgent phải build, ký, tin cậy hay ký lại sau mỗi bảy ngày. Hãy bật gỡ lỗi USB, cắm điện thoại vào, chấp nhận lời nhắc cấp quyền trên thiết bị, và nó xuất hiện trong `android_devices` với mọi công cụ hoạt động được trên nó. Một thiết bị chưa được cấp quyền sẽ được báo cáo đúng như vậy kèm gợi ý về lời nhắc, chứ không phải như một lỗi bí ẩn.

Ba điểm lưu ý thành thật:

- **Tốc độ khung hình thấp hơn khi qua USB** — khoảng 2–5 fps với điện thoại so với 5–10 fps trên trình giả lập, vì mỗi khung hình đều băng qua liên kết USB dưới dạng một tệp PNG đầy đủ.
- **Gõ tiếng CJK cần ADBKeyboard** (xem ở trên); điều này ảnh hưởng đến cả trình giả lập lẫn điện thoại.
- **`android_shutdown` không thể tắt nguồn một chiếc điện thoại.** adb không có động từ như vậy; công cụ nói thẳng điều đó thay vì giả vờ.

## Hiệu năng

Đo trên một trình giả lập (Android 14, 1080×2400):

| | |
| --- | --- |
| Vòng lặp screencap thường trú | ≈ 8 fps |
| Khung hình đầu tiên của `ensureStreaming` | ~200 ms |
| Vòng gọi `input tap` | ~130 ms |

Chính tiến trình con thường trú duy nhất mang lại con số này: sinh một tiến trình `adb` cho mỗi khung hình tốn ~50–100 ms trước khi có bất kỳ pixel nào nhúc nhích. Hãy kỳ vọng ~5–10 fps trên trình giả lập và ~2–5 fps trên điện thoại cắm USB, tùy vào máy và mật độ điểm ảnh của màn hình.

## Cài đặt vào DSH

```sh
dsh plugin --profile web add @zseven-w/dsh-android@latest
dsh web
```

Hoặc thêm nó làm phụ thuộc của một gói hồ sơ sẵn có:

```sh
pnpm add @zseven-w/dsh-android
```

## Bắt đầu nhanh

1. **Tìm thiết bị** — "Liệt kê các thiết bị Android." → `android_devices`.
2. **Khởi động luồng** — "Truyền hình ảnh emulator-5554." → `android_boot`. Bảng mở ra với thiết bị đang trực tiếp. (Một tên AVD sẽ khởi động trình giả lập đó trước.)
3. **Chạm ngay trên video** — chạm hoặc kéo trực tiếp trên bảng, hoặc để agent điều khiển: "Mở Cài đặt, rồi chạm vào Màn hình." → `android_interact`, hoặc `android_ui_tree` + `android_tap_element` để chạm theo danh tính, hoặc `android_find_text` + `android_tap_text` khi cây UI mù tịt.
4. **Build và chạy ứng dụng của bạn** — "Build và chạy /path/to/MyApp." → `android_build_run`. Một lần build Gradle đầy đủ mất vài phút; khi xong, ứng dụng khởi chạy và bạn theo dõi nó trực tiếp trong bảng.
5. **Đọc nhật ký** — "Hiển thị logcat hai phút gần nhất của com.example.app." → `android_logs`.

## Khắc phục sự cố

- **Mọi công cụ đều báo không có adb** — thông báo lỗi nêu rõ ba tầng phân giải. Hãy đặt `ADB=/path/to/adb`, đưa `adb` vào `PATH`, hoặc cài bộ platform-tools của SDK (`sdkmanager "platform-tools"`).
- **Thiết bị ở trạng thái `unauthorized`** — hãy chấp nhận lời nhắc gỡ lỗi USB trên màn hình thiết bị. `android_devices` báo cáo trạng thái một cách trung thực thay vì giấu thiết bị đi.
- **`android_boot` không tìm thấy AVD** — không tìm ra trình khởi chạy `emulator`. Hãy khởi động trình giả lập bằng bất kỳ cách nào; nó sẽ xuất hiện trong `android_devices` ngay khi adb thấy nó, và `android_boot` khi đó nhận serial của nó.
- **Văn bản ngoài ASCII bị từ chối** — hãy cài ADBKeyboard và chọn nó làm phương thức nhập (xem mục Yêu cầu). Việc từ chối là có chủ ý: `input text` sẽ âm thầm bỏ hoặc làm hỏng các ký tự đó.
- **`android_find_text` báo OCR không khả dụng** — OCR cần một máy chủ macOS (framework Vision của Apple). 17 công cụ không dùng OCR vẫn chạy được ở mọi nơi.
- **Luồng tự dừng** — đó là chính sách nhàn rỗi chứ không phải sự cố: khi không còn bên tiêu thụ nào (bảng đã đóng, không thẻ nào được gắn, không tuyến nào hoạt động), luồng dừng sau 5 phút và khởi động lại ở lần gọi công cụ hoặc lần mở bảng kế tiếp. Một vòng lặp bị sập sẽ tự khởi động lại trong khoảng ~5 giây.
- **Hướng xoay trông sai trên màn hình chính** — trình khởi chạy và ứng dụng Cài đặt tự ghim mình ở chế độ dọc và bỏ qua `user_rotation`. Đó là hành vi bình thường của Android, không phải lỗi plugin; hãy xoay bên trong một ứng dụng có cho phép.

## Phát triển

```sh
pnpm install
pnpm run build      # host tsc + client bundle → lib/
pnpm run typecheck
pnpm test           # every static suite; no device required
```

Các bộ smoke test trong `scripts/` chạy trên thư mục `lib/` đã build. Tất cả đều tĩnh, ngoại trừ `dev-emulator-smoke.mjs` vốn cần một thiết bị và báo SKIP (thoát mã 0) khi không có thiết bị nào.

| Script | Phạm vi kiểm thử |
| --- | --- |
| `node scripts/dev-adb-smoke.mjs` | Phân giải adb (env / PATH / SDK) đối chiếu với một binary giả lập, phân tích `devices -l`, `exec-out` an toàn nhị phân, bộ tách khung hình PNG cùng cơ chế đồng bộ lại, thoát ký tự cho input-text, và vòng đời của máy chủ (luồng, điều khiển, dừng khi nhàn rỗi, giải phóng) đối chiếu với một chuỗi công cụ giả. |
| `node scripts/dev-routes-static-smoke.mjs` | Các tuyến có chữ ký đối chiếu với một máy chủ giả: cấp quyền tương đối, token hết hạn/giả mạo/sai loại, hàng rào loopback, phong bì 405/415/400, các trường hợp từ chối thiết bị có mã, xác thực `/control`, hình dạng lệnh xoay, kiểm tra chứa của ảnh chụp màn hình, và luồng multipart trực tiếp. |
| `node scripts/dev-tools-smoke.mjs` | Các công cụ cốt lõi đối chiếu với một máy chủ giả thông qua đường nối `createAndroidTools`. |
| `node scripts/dev-uitree-smoke.mjs` | Công cụ cây UI và hàng danh sách: phân tích XML `uiautomator`, bộ chọn, giới hạn độ sâu, các heuristic cho hàng và bộ đếm. |
| `node scripts/dev-logs-smoke.mjs` | `android_logs` chế độ snapshot/follow, bộ lọc, giới hạn, và việc thu hồi tiến trình. |
| `node scripts/dev-panel-smoke.mjs` | Các thành phần của bảng, chế độ kích thước, kiểu khung, logic dock/trigger/viên trạng thái (chỉ SSR). |
| `node scripts/dev-emulator-smoke.mjs [serial]` | Thiết bị thật: khung hình đầu tiên, tốc độ khung hình duy trì, vòng gọi chạm, giải phóng. |

## Khắc phục sự cố
### Luồng trắng xóa / trống trên trình giả lập

Nếu bảng truyền về một ảnh trắng đặc (hoặc đen) trong khi `android_ui_tree`
vẫn thấy các phần tử UI thật, thì việc đọc ngược framebuffer từ GPU của máy chủ
đang hỏng trên máy bạn (một lỗi gfxstream đã biết trên một số máy macOS —
bản thân `screencap` trả về khung hình trắng, nên mọi công cụ màn hình đều bị ảnh hưởng).
Hãy khởi chạy lại trình giả lập với chế độ dựng hình bằng phần mềm:

```bash
emulator -avd <name> -gpu swiftshader_indirect
```

hoặc đặt `hw.gpu.mode=swiftshader_indirect` trong `config.ini` của AVD. Thiết bị
vật lý không bao giờ bị ảnh hưởng.

## Lộ trình

- **Một nguồn hình có tốc độ khung hình cao hơn.** Đường nối `StreamSource` được thiết kế cắm-thay có chủ ý: một hướng `scrcpy-server` + WebCodecs H.264 có thể thay thế luồng PNG từng khung mà không phải động đến các tuyến, các công cụ hay bảng hiển thị.
- **Hot reload cho bản xem trước Compose.** Phiên bản song sinh iOS hoán đổi nóng các bản xem trước SwiftUI dưới dạng dylib; Compose hiện chưa có nguyên thủy hoán đổi nóng tương đương, nên đây vẫn là một hạng mục tương lai thay vì một thứ đã phát hành nhưng chập chờn.

## Hệ sinh thái

- [DSH iOS Simulator](https://github.com/ZSeven-W/dsh-ios) — cùng kiến trúc đó cho Trình mô phỏng iOS và iPhone kết nối qua USB
- [DSH Crew](https://github.com/ZSeven-W/dsh-crew) — điều phối công việc tới các agent DSH từ Claude Code / Codex
- [DSH Noema](https://github.com/ZSeven-W/dsh-noema) — bộ nhớ dài hạn cho DSH
- [DSH OpenPencil](https://github.com/ZSeven-W/dsh-openpencil) — kiểm tra và chỉnh sửa tài liệu thiết kế `.op` ngay trong cuộc hội thoại

## Ghi nhận &amp; giấy phép

- [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools) (`adb`) — phân giải lúc chạy, không bao giờ được phát hành lại kèm theo: giấy phép SDK của Google không cho phép đóng gói nó.
- [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) — Senzhk — bộ IME tùy chọn trên thiết bị đứng sau khả năng nhập ký tự ngoài ASCII (Apache-2.0; không đóng gói kèm).
- Kiến trúc và tư thế bảo mật của các tuyến được chia sẻ với [dsh-ios](https://github.com/ZSeven-W/dsh-ios), nơi plugin này được chuyển thể sang.
- Xem [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) để biết đầy đủ các thông báo.

**Giấy phép**: MIT
