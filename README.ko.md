<p align="center">
  <img src="./docs/images/dsh-android-logo.png" alt="DSH Android" width="120" />
</p>

<h1 align="center">DSH Android</h1>

<p align="center">
  <strong><a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> 대화 안에서 살아 움직이는 Android 기기 — 에뮬레이터든 USB 연결 휴대폰이든, 전부 adb로 구동합니다.</strong><br />
  <sub>20개 에이전트 도구 &bull; 프로세스 내 실시간 스트림, 외부 헬퍼 불필요 &bull; 3버튼 내비게이션 패널 &bull; Gradle 빌드 &amp; 실행 &bull; Vision OCR</sub>
</p>

<p align="center">
  <sub>npm: <code>@zseven-w/dsh-android</code> &middot; 현재 플러그인 릴리스: <code>0.1.0-rc.2</code> &middot; DSH <code>0.1.1-rc.1</code>에서 검증됨</sub>
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <b>한국어</b> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

<br />

<p align="center">
  <img src="./docs/images/dsh-android-overview.png" alt="DSH Android — 대화 안의 실시간 Android 기기" width="100%" />
</p>
<p align="center"><sub>DSH 대화 안에서 바로 스트리밍하고 조작하는 Android 기기 — 가운데는 에이전트의 도구 호출, 오른쪽은 실시간 기기 패널</sub></p>

## DSH Android를 사용하는 이유

DSH Android는 대화 안에서 에이전트에게 진짜 Android 기기를 건네주고, 동시에 당신에게는 픽셀을 건네줍니다. 에이전트는 에뮬레이터나 USB로 연결한 휴대폰에서 스트림을 시작하고, Gradle 프로젝트를 빌드·설치하고, `resource-id`/텍스트나 OCR로 UI를 조작하고, logcat을 읽고, 프로세스와 메모리를 들여다볼 수 있습니다. 그동안 기기의 실시간 화면은 상시 사이드바 패널에 렌더링되며, 영상 위에서 직접 탭·드래그·회전하고 뒤로 / 홈 / 최근 앱을 누를 수 있습니다. 이미지 블록도, 화면 녹화 파일도 없습니다. 시각적 바이트가 UI에 도달하는 경로는 DSH 웹서버가 제공하는 서명되고 곧 만료되는 URL뿐입니다.

코드 경로는 정확히 하나입니다. `adb devices -l`이 보고하는 **serial**이 기기의 유일한 신원이며, `emulator-5554`도 USB serial도 `ip:port` 타깃도 모두 똑같이 동작합니다. 플러그인은 어떤 에뮬레이터 제품(AVD, Genymotion, WSA, 클라우드 기기 팜)에도 묶여 있지 않고, "시뮬레이터냐 실기기냐"를 따로 고민할 필요도 없습니다.

| | |
| --- | --- |
| 📱 **대화 안의 실시간 기기** | **프로세스 내에서** 생성한 `multipart/x-mixed-replace` PNG 스트림을 최신 프레임 버퍼에서 곧바로, 서명된 `/_dsh/dsh-android/*` 라우트를 통해 전달합니다. |
| 🔌 **외부 스트림 헬퍼 없음, 내부 포트 없음** | 상주하는 `adb exec-out` 자식 프로세스 하나가 `while :; do screencap -p; done`을 실행하고, 이어붙은 PNG는 호스트가 직접 프레임으로 나눕니다. 프록시할 루프백 스트림 서버도, 관리할 포트 범위도, 비정상 종료 후 인수할 것도 없습니다. |
| 🧩 **단일 adb 코드 경로** | adb에게도, 이 플러그인에게도 에뮬레이터와 휴대폰은 같은 것입니다. `simctl`/WebDriverAgent 이중 스택도, 실기기를 쓰기 전 빌드하고 신뢰시키는 절차도 없습니다. |
| 🛠️ **20개 에이전트 도구** | 기기 목록, 부팅/종료, 스크린샷, 상호작용, Gradle 빌드 &amp; 실행, 앱 목록/실행, `uiautomator` UI 트리 + 요소 기반 탭, 목록/피드 행 동작, Vision OCR 찾기/탭/대기, logcat, 프로세스, ANR/크래시 백트레이스, meminfo, 앱 정보. |
| 👆 **3버튼 내비게이션 패널** | 실시간 영상 위에서 탭과 드래그. 툴바에는 **◁ 뒤로 · ○ 홈 · □ 최근 앱**과 회전·스크린샷·새로고침이 있고, 기기 메뉴에서 알림 셰이드·빠른 설정·잠금·깨우기·어시스턴트를 실행합니다. |
| 🖼️ **네이티브 멀티모달** | 이미지를 처리할 수 있는 모델에서는 모든 캡처 도구(screenshot, interact, tap_element, tap_text, tap_row)가 스크린샷 자체를 image block으로 반환합니다 — 모델이 화면을 직접 봅니다. OCR은 픽셀 단위로 정확한 텍스트 탭과 텍스트 전용 경로를 위해 남아 있고, 텍스트 전용 모델은 기존의 평범한 JSON 요약을 그대로 받습니다. |
| 🔐 **서명된 루프백 전용 라우트** | 모든 라우트는 어떤 capability를 확인하기 **전에** 루프백 피어, 루프백 `Host`(DNS 리바인딩 거부), Fetch-Metadata/Origin 검사를 요구합니다. HMAC-SHA256 capability는 10분 안에 만료됩니다. |
| 🔍 **의미 기반 + 시각 기반 자동화** | `android_ui_tree`가 `uiautomator` 계층을 덤프하고 `android_tap_element`가 `resource-id`, 텍스트, content-description으로 탭합니다. 트리가 비어 있거나 텍스트가 이미지에 구워져 있으면 좌표를 추측하는 대신 `android_find_text` / `android_tap_text`가 화면을 OCR합니다. |

## 도구

20개 도구는 모든 호스트에 등록되고 순수한 JSON을 반환합니다 — 시각적 바이트는 오직 `presentationMeta` + 서명된 라우트를 통해서만 UI에 도달하며, 이미지 블록으로는 절대 전달되지 않습니다. adb를 찾지 못해도 도구는 그대로 등록되어 있고, 모든 호출이 해결 방법을 명시한 설명형 오류로 실패합니다.

좌표는 어디서나 **스트림 프레임 기준 정규화 0..1**입니다. 프레임은 디스플레이 회전을 따르고(가로 모드 앱은 1080×2400 기기에서 2400×1080으로 스트리밍됨), `input tap`도 같은 좌표 공간을 쓰므로 이 플러그인 어디에도 클라이언트 측 회전 계산은 존재하지 않습니다.

### 핵심 도구

| 도구 | 역할 | 주요 매개변수 |
| --- | --- | --- |
| `android_devices` | `adb devices -l`이 보고하는 모든 기기(serial, 상태, 에뮬레이터/실기기, 모델, Android 버전, API 레벨, AVD 이름)와 이 머신의 AVD 이름(`avds`)을 나열합니다. 다른 도구가 받는 serial을 찾을 때 사용하세요. 열거에 실패하면 빈 목록을 반환하는 대신 예외를 던집니다. | — |
| `android_boot` | 실시간 스트림을 시작합니다. ONLINE 상태의 serial을 넘기면 즉시 스트리밍하고, AVD 이름을 넘기면 해당 에뮬레이터를 먼저 실행한 뒤 부팅이 끝나면 스트리밍합니다(콜드 스타트는 몇 분 걸립니다). 스트림은 대화 내내 유지되므로 패널이 기기를 계속 실시간으로 보여줄 수 있습니다. | `device`(필수 — serial 또는 AVD 이름) |
| `android_shutdown` | 에뮬레이터를 종료하고(`adb emu kill`), 스트림이 그 기기를 향하고 있으면 스트림도 중지합니다. 실기기는 이유와 함께 거부됩니다: adb로는 휴대폰 전원을 끌 수 없습니다. | `device` |
| `android_screenshot` | PNG를 캡처하고 작은 JSON 요약(경로, 바이트 수, 크기, 기기)을 반환합니다. 이미지는 카드와 패널에 렌더링되며 이미지 블록으로는 절대 반환되지 않습니다. | `device`(선택 — 스트리밍 중인 기기, 없으면 유일하게 온라인인 기기) |
| `android_interact` | 스트리밍 중인 기기와 상호작용합니다: 정규화 0..1 좌표로 탭, 텍스트 입력, 내비게이션/하드웨어 버튼(`back`, `home`, `recents`, `power`, `volume_up`, `volume_down`, `menu`, `enter`, `delete`) 누르기, 스와이프 제스처 전송, 스크롤. 동작이 안정된 뒤(~300 ms) 새 스크린샷이 결과를 보여줍니다. | `action`(필수 — `tap`/`type`/`button`/`gesture`/`scroll`), `x`/`y`, `text`, `name`, `json`, `device` |
| `android_list_apps` | 기기에 설치된 패키지(`pm list packages`)를 `dumpsys package`의 버전 이름과, 해석 가능한 경우 사람이 읽을 수 있는 레이블과 함께 나열합니다 — 서드파티 패키지 이름은 추측할 수 없으니 먼저 목록을 보거나 `android_launch_app`에 `name`을 넘기세요. | `device`, `query`(대소문자 구분 없는 부분 문자열, CJK 포함), `include_system`(기본값 false) |
| `android_launch_app` | 설치된 앱을 `packageName`으로, 또는 `name`(같은 목록을 통해 해석되는 대소문자 구분 없는 레이블 부분 문자열)으로 실행합니다. 둘 중 정확히 하나만 지정합니다. `relaunch`를 주면 먼저 앱을 강제 종료합니다. | `packageName` 또는 `name`(정확히 하나), `device`, `relaunch` |
| `android_build_run` | Gradle 프로젝트를 빌드하고(`./gradlew assembleDebug`), 생성된 debug APK를 설치한 뒤(`adb install -r`) 실행합니다. 전체 빌드는 몇 분이 걸리고, 실패 시 결과에 Gradle 오류 출력의 마지막 부분이 담깁니다. | `projectPath`(필수), `device` |

### UI 트리 및 행 도구 (`uiautomator`)

| 도구 | 역할 | 주요 매개변수 |
| --- | --- | --- |
| `android_ui_tree` | 포그라운드 앱의 `uiautomator` 계층을 노드로 덤프합니다 — `type`(클래스 이름 끝부분), `text`, `contentDesc`, `resourceId`, 픽셀 단위 `bounds`, `enabled`, `focused` — 약 40 KB로 제한됩니다(가장 깊은 단계부터 잘려 나가고 `truncated`가 설정됩니다). | `device`, `max_depth`, `filter`(text/content-description/resource-id에 대한 대소문자 구분 없는 부분 문자열) |
| `android_tap_element` | 신원으로 요소를 탭합니다 — `resource_id`는 노드의 `resource-id`와, `text`는 텍스트나 content-description과 일치시킵니다. 정확히 일치를 먼저, 그다음 대소문자 구분 없는 부분 일치를 시도합니다. 중첩된 중복은 하나의 대상으로 합쳐지고, 모호하면 임의로 고르지 않고 최대 8개 후보를 나열합니다. 비활성 요소는 거부됩니다. 탭은 요소 중심에 떨어지고 약 300 ms 뒤 스크린샷이 결과를 보여줍니다. `expect_text` / `expect_gone`을 넘기면 탭과 검증이 한 번의 왕복으로 합쳐집니다. | `device`, `resource_id`, `text`, `expect_text`, `expect_gone` |
| `android_ui_rows` | 목록/피드 화면(`RecyclerView` 계열)을 원시 트리가 아니라 **행**으로 읽습니다: 같은 모양으로 반복되는 자식들이 행이 되고, 각 행은 인덱스, 픽셀 프레임, 집계된 레이블, 그리고 그 레이블에서 파싱한 카운터(숫자 + 분류사 토큰, 한국어·중국어·영어 모두 — 앱 어휘를 하드코딩하지 않습니다)를 담습니다. 카운터 키는 그대로 왕복합니다: 나열된 키를 한 글자도 바꾸지 말고 `android_tap_row.expect_count`에 넘기세요. | `device`, `max_depth` |
| `android_tap_row` | 보이는 한 행 안의 상대 위치를 탭합니다(`index`는 `android_ui_rows`에서, `x`/`y`는 그 행 프레임에 대한 비율이며 기본값 0.5 = 중앙). 프레임은 **새로** 읽은 트리에서 가져오므로 절대 좌표를 추측하지 않고, 범위를 벗어난 인덱스는 clamp하지 않고 FAIL합니다. `expect_count={key, delta}`를 주면 약 800 ms 뒤 행을 다시 읽어 카운터가 정확히 ±1만큼 움직였는지 검증하며, 알 수 없는 키는 탭이 일어나기 **전에** 거부합니다. | `device`, `index`(필수), `x`, `y`, `expect_count`(`{key, delta}`) |

### OCR·로그·디버그 도구

| 도구 | 역할 | 주요 매개변수 |
| --- | --- | --- |
| `android_find_text` | 플러그인이 직접 컴파일한 Vision 헬퍼로 **현재** 화면을 OCR합니다(accurate 인식, zh-Hans + en-US). UI 트리가 비어 있거나 부실할 때, 텍스트가 그래픽으로 그려져 있을 때(배지 숫자, 이미지에 구워진 가격), 또는 화면에 무엇이 있는지 독립적으로 확인하고 싶을 때 사용하세요. `{device, size, items:[{text, confidence, rect}]}`를 반환하며 rect는 좌상단 원점의 **픽셀** 박스이고, 신뢰도 순으로 정렬되어 약 40 KB에서 잘립니다. macOS 호스트 전용. | `device`, `query`(대소문자 구분 없는 부분 문자열), `min_confidence`(기본값 0.3) |
| `android_tap_text` | **현재** 화면을 OCR하고 가장 잘 맞는 텍스트의 중심을 탭합니다 — 정확히 일치 → 포함 → 후보 나열이라는 `android_tap_element`와 똑같은 규칙을, UI 트리가 볼 수 없는 텍스트에 적용합니다. 일치한 픽셀 중심을 프레임 크기로 정규화해 탭으로 보내고, 약 300 ms 뒤 새 스크린샷이 결과를 보여줍니다. macOS 호스트 전용. | `device`, `query`(필수), `min_confidence`, `expect_text`, `expect_gone` |
| `android_wait_for` | 텍스트가 나타나거나 사라질 때까지 기다립니다. 같은 캡처 + OCR 파이프라인을 600 ms마다 폴링하며 조건이 성립하거나 타임아웃될 때까지 계속합니다(기본 8초, 최대 60초). 타임아웃은 오류가 아니라 정상적인 `matched:false` 응답입니다. macOS 호스트 전용. | `device`, `text`(필수), `mode`(`appear`/`disappear`), `timeout_ms`, `min_confidence` |
| `android_logs` | 기기의 로그를 읽습니다: `snapshot`(최근 구간에 대한 `logcat -d -v time`, 기본 2m) 또는 `follow`(`duration_seconds` 동안의 유한한 실시간 캡처, 기본 10, 최대 60 — 결코 매달린 스트림이 되지 않습니다). `bundle_id`(Android 패키지 이름, pid로 해석됨)로 앱 하나만 필터링할 수 있습니다. 출력은 약 300줄 / 30 KB로 제한되며 범위를 좁히는 힌트가 붙습니다. | `device`, `mode`(`snapshot`/`follow`), `duration`, `duration_seconds`, `bundle_id`, `grep` |
| `android_processes` | 기기에서 실행 중인 프로세스(`ps -A`)를 `{pid, name}` 형태로 나열합니다 — `android_backtrace`에 넘길 pid의 출처입니다. | `device`, `filter`(프로세스 이름에 대한 대소문자 구분 없는 부분 문자열) |
| `android_backtrace` | 프로세스에 스택 덤프를 요청하고(`kill -3`) `/data/anr/`에서 생성된 ANR 트레이스를 읽습니다. 루팅되지 않은 대부분의 기기는 그 디렉터리를 거부하므로, 이때는 크래시 버퍼(`logcat -b crash -d`)로 격하되고 어떤 엔진이 답했는지, 무엇을 볼 수 없는지 정직하게 보고합니다. | `device`, `pid` 또는 `bundle_id` |
| `android_meminfo` | `dumpsys meminfo <package>`를 파싱합니다: 총 PSS, Java/native/graphics 분해, 상위 카테고리 — 누수 요약에 대한 Android식 답입니다. | `device`, `bundle_id`(필수) |
| `android_app_info` | `dumpsys package <package>`에서 얻는 설치 앱 정보: 버전 이름과 코드, 데이터 디렉터리, 코드 경로, 최초 설치 시각, 시스템 앱 플래그. 앱이 없으면 예외를 던지지 않고 `installed: false`와 `android_list_apps`를 지목하는 note를 반환합니다. | `device`, `bundle_id`(필수) |

## 표시 영역

- **사이드바 패널.** 실시간 화면은 상시 표시되는 오른쪽 패널(대화를 옆으로 밀어내는 고정 도크, 좁은 뷰포트에서는 중앙 오버레이)에 있습니다. 실시간 PNG 스트림을 렌더링하고 영상 위에서 바로 클릭 탭과 드래그 제스처를 받아들이며, 툴바에는 **◁ 뒤로**, **○ 홈**, **□ 최근 앱**과 회전·스크린샷·새로고침이 있습니다. 기기 메뉴는 기기 수준 동작 다섯 가지(알림 셰이드, 빠른 설정, 잠금, 깨우기, 어시스턴트)를 실행합니다. 기기 선택기는 모든 adb 기기를 종류별로 묶어 **하나의** 목록에 보여주며, 오프라인 AVD는 클릭 시 부팅이 아니라 `android_boot`를 가리키는 힌트로 표시됩니다. 크기 모드와 프레임 스타일(프레임 없음 / 베젤 / 실제 기기 셸)은 iOS 쌍둥이와 동일하게 동작하고, 패널은 프레임 자체의 자연 크기에서 종횡비를 유도하므로 회전에 아무 설정도 필요 없습니다.
- **컴팩트 대화 카드.** 도구 결과는 인라인 이미지 없이 한 줄 카드로 렌더링됩니다: 기기 이름, 동작 서브 라벨, 상태 배지, 그리고 '사이드바에서 열기' 안내. 행을 클릭하면 패널이 열립니다.
- **입력창 위의 상태 캡슐.** 패널이 닫혀 있고 스트림이 온라인이면 입력창 위에 작은 알약이 나타나고, 클릭하면 패널이 열립니다.
- **표준 모드와 Code 모드.** 표준 세션은 호스트가 투사한 `presentationMeta`를 사용합니다. 중첩된 Code 모드 디스패치는 meta를 전달하지 않으므로 클라이언트가 영구 결과 JSON에서 동일한 meta를 재구성합니다 — 패널, 카드, 캡슐 모두 두 모드에서 동작합니다.

## 보안

- **브라우저는 adb와 통신하지 않으며, 애초에 통신할 내부 포트가 존재하지 않습니다.** 스트림은 이 프로세스 안에서 생성되어 메모리에서 바로 제공되고, 모든 바이트는 plugin 소유의 `/_dsh/dsh-android/*` 라우트를 통해 DSH 웹서버 오리진을 경유합니다: `/stream/<token>`(실시간 multipart PNG), `/screenshot/<token>`(캐시된 PNG), 그리고 `/grant`, `/switch-device`, `/devices`, `/capture`, `/status`, `/control`, `/device-action`. 이는 루프백 스트림 서버를 프록시하는 구성보다 엄격하게 더 작은 공격 표면입니다.
- **삼중 루프백 펜스를, 어떤 capability를 읽기 전에 적용합니다.** 전송 계층 피어는 루프백 주소여야 하고, `Host` 헤더는 루프백 권한을 가리켜야 하며(따라서 DNS 리바인딩 `Host`는 거부됩니다), Fetch-Metadata/`Origin`은 동일 출처여야 합니다. Host와 Origin은 호출자가 통제하는 데이터이므로 그것만으로는 결코 신뢰하지 않습니다.
- **10분 안에 만료되는 HMAC-SHA256 capability.** 형식은 `base64url(payload).base64url(mac)`이며 DSH 홈별 32바이트 키(`<DSH_HOME>/cache/dsh-android/stream-access.key`, 모드 0600, 원자적으로 생성)로 서명됩니다. 한 기기용으로 발급된 capability는 다른 기기가 스트림 슬롯을 가져가는 순간 무효가 되고, 스크린샷용 capability를 스트림 라우트에 재생할 수도 없습니다.
- **스크린샷 라우트는 정확히 한 디렉터리만 제공합니다.** 경로는 `lstat`으로 단계별 검사하고(심볼릭 링크는 무조건 거부), `realpath` 포함 여부 검사로 마무리하며, `O_NOFOLLOW`로 열고 크기를 제한하고 읽은 뒤 **다시 검증**합니다 — 그래서 발급과 조회 사이에 심볼릭 링크로 바꿔치기된 파일은 결코 제공되지 않습니다.
- **`/grant`는 아무것도 부팅하지 않습니다.** 이미 온라인인 기기에 대해 프레임 루프를 시작할 뿐이며, 다른 기기에서 스트림을 빼앗는 것은 409 `device_busy`로 거부합니다. 기기 전환은 명시적인 `/switch-device` 동작이 필요하고, AVD 부팅은 여전히 `android_boot` 도구의 몫입니다.
- **Keep-alive와 유휴 중지.** 크래시된 프레임 루프는 백그라운드에서 재시작됩니다(약 5초 지연). 소비자가 0이면 스트림은 5분 뒤 스스로 멈춥니다. 의도적인 중지는 절대 되돌리지 않습니다.

## 요구 사항

- **Node ≥ 24.11.0.**
- **adb**(Android SDK platform-tools). 해석 순서는 `ADB` 환경 변수 → `PATH`의 `adb` → `<ANDROID_HOME>`/`<ANDROID_SDK_ROOT>`/OS별 기본 SDK 루트 + `/platform-tools/adb`입니다. `sdkmanager "platform-tools"`, Android Studio, 또는 `brew install --cask android-platform-tools`로 설치하세요. adb가 없어도 plugin은 로드되고 20개 도구가 모두 등록되며, 호출할 때마다 무엇이 없는지 설명합니다.
- **기기 한 대**: 제품을 가리지 않는 에뮬레이터, 또는 USB 디버깅을 켠 휴대폰. `emulator` 런처는 선택 사항이며 'AVD 이름으로 `android_boot`를 호출'할 때만 필요합니다 — 그 외에는 adb가 볼 수 있는 기기라면 무엇이든 동작합니다.
- **패널에는 웹 번들이 포함된 DSH ≥ 0.1.0-rc.6**이 필요합니다. 헤드리스 프로필도 동작합니다: 20개 도구는 모두 정상 작동하고 실시간 화면만 없습니다.
- **OCR에는 macOS 호스트**가 필요합니다(`android_find_text` / `android_tap_text` / `android_wait_for`만 해당): plugin은 첫 사용 시 번들된 `assets/ocr.swift`를 `swiftc`로 `~/Library/Caches/dsh-android/bin/ocr`에 컴파일합니다. Linux와 Windows 호스트에서는 이 세 도구가 OCR에 macOS Vision 프레임워크가 필요하다고 보고하며, 나머지 17개는 영향을 받지 않습니다. 재정의: `DSH_ANDROID_OCR_DIR`, `DSH_ANDROID_OCR_SWIFT`, `DSH_ANDROID_SWIFTC`.
- **ADBKeyboard**(선택, CJK와 이모지 입력용): `adb shell input text`는 ASCII만 지원합니다. 기기에 [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard)를 설치하고 활성 IME로 선택하면 비 ASCII 텍스트가 그 브로드캐스트 인터페이스를 통해 전달됩니다. 없으면 비 ASCII 입력은 설치 힌트와 함께 **거부**됩니다 — 조용히 잘못 입력되는 일은 없습니다.

## 실기기

WebDriverAgent처럼 빌드하고 서명하고 신뢰시키고 7일마다 다시 서명해야 하는 것은 없습니다. USB 디버깅을 켜고, 휴대폰을 연결하고, 기기에서 인증 프롬프트를 수락하면 `android_devices`에 나타나고 모든 도구가 그대로 동작합니다. 인증되지 않은 기기는 알 수 없는 실패가 아니라 프롬프트 힌트와 함께 그 상태 그대로 보고됩니다.

솔직히 밝혀야 할 세 가지 제약:

- **USB에서는 프레임률이 더 낮습니다** — 휴대폰에서 대략 2–5 fps, 에뮬레이터에서 5–10 fps입니다. 모든 프레임이 완전한 PNG로 USB 링크를 건너기 때문입니다.
- **CJK 입력에는 ADBKeyboard가 필요합니다**(위 참조). 에뮬레이터와 휴대폰 모두 마찬가지입니다.
- **`android_shutdown`은 휴대폰 전원을 끌 수 없습니다.** adb에 그런 동사가 없으므로, 도구는 할 수 있는 척하지 않고 그렇다고 말합니다.

## 성능

에뮬레이터에서 측정(Android 14, 1080×2400):

| | |
| --- | --- |
| 상주 screencap 루프 | ≈ 8 fps |
| `ensureStreaming` 첫 프레임 | ~200 ms |
| `input tap` 왕복 | ~130 ms |

이 수치를 만들어내는 것은 단 하나의 상주 자식 프로세스입니다: 프레임마다 `adb`를 spawn하면 픽셀이 움직이기도 전에 ~50–100 ms가 듭니다. 머신과 화면 밀도에 따라 에뮬레이터에서 ~5–10 fps, USB 휴대폰에서 ~2–5 fps를 예상하세요.

## DSH에 설치

```sh
dsh plugin --profile web add @zseven-w/dsh-android@latest
dsh web
```

또는 기존 프로필 패키지의 의존성으로 추가합니다:

```sh
pnpm add @zseven-w/dsh-android
```

## 빠른 시작

1. **기기 찾기** — "Android 기기 목록을 보여줘." → `android_devices`.
2. **스트림 시작** — "emulator-5554를 스트리밍해줘." → `android_boot`. 패널이 열리고 기기가 실시간으로 보입니다. (AVD 이름을 주면 해당 에뮬레이터를 먼저 부팅합니다.)
3. **영상 위에서 탭** — 패널에서 직접 탭하거나 드래그하고, 또는 에이전트에게 맡기세요: "설정을 열고 디스플레이를 눌러줘." → `android_interact`, 신원 기반 탭은 `android_ui_tree` + `android_tap_element`, 트리가 보이지 않을 때는 `android_find_text` + `android_tap_text`.
4. **앱 빌드하고 실행** — "/path/to/MyApp을 빌드해서 실행해줘." → `android_build_run`. 전체 Gradle 빌드는 몇 분이 걸리고, 끝나면 앱이 실행되어 패널에서 실시간으로 볼 수 있습니다.
5. **로그 읽기** — "com.example.app의 최근 2분 logcat을 보여줘." → `android_logs`.

## 문제 해결

- **모든 도구가 adb를 쓸 수 없다고 함** — 오류가 3단계 해석 순서를 그대로 알려줍니다. `ADB=/path/to/adb`를 설정하거나, `adb`를 `PATH`에 두거나, SDK platform-tools를 설치하세요(`sdkmanager "platform-tools"`).
- **기기가 `unauthorized` 상태** — 기기 화면에서 USB 디버깅 프롬프트를 수락하세요. `android_devices`는 기기를 숨기지 않고 상태를 정직하게 보고합니다.
- **`android_boot`가 AVD를 찾지 못함** — `emulator` 런처를 발견하지 못했다는 뜻입니다. 어떤 방법으로든 에뮬레이터를 실행하면 adb가 보는 즉시 `android_devices`에 나타나고, `android_boot`가 그 serial을 받습니다.
- **비 ASCII 텍스트가 거부됨** — ADBKeyboard를 설치하고 입력 방식으로 선택하세요(요구 사항 참조). 이 거부는 의도적입니다: `input text`는 해당 문자를 조용히 버리거나 망가뜨립니다.
- **`android_find_text`가 OCR을 쓸 수 없다고 함** — OCR에는 macOS 호스트(Apple Vision 프레임워크)가 필요합니다. OCR이 아닌 17개 도구는 어디서나 동작합니다.
- **스트림이 저절로 멈춤** — 크래시가 아니라 유휴 정책입니다: 소비자가 0이면(패널이 닫힘, 마운트된 카드 없음, 활성 라우트 없음) 스트림은 5분 뒤 멈추고 다음 도구 호출이나 패널 열기에서 다시 시작합니다. 크래시된 루프는 약 5초 안에 스스로 재시작합니다.
- **런처에서 회전이 이상함** — 런처와 설정 앱은 스스로를 세로 모드에 고정하고 `user_rotation`을 무시합니다. 플러그인 버그가 아니라 정상적인 Android 동작이니, 회전을 허용하는 앱 안에서 회전해 보세요.

## 개발

```sh
pnpm install
pnpm run build      # 호스트 tsc + 클라이언트 번들 → lib/
pnpm run typecheck
pnpm test           # 모든 정적 스위트; 기기 불필요
```

`scripts/`의 스모크 스위트는 빌드된 `lib/`를 검증합니다. 기기가 필요하고 기기가 없으면 SKIP(종료 코드 0)을 보고하는 `dev-emulator-smoke.mjs`를 제외하면 전부 정적입니다.

| 스크립트 | 다루는 내용 |
| --- | --- |
| `node scripts/dev-adb-smoke.mjs` | shim 바이너리에 대한 adb 해석(env / PATH / SDK), `devices -l` 파싱, 바이너리 안전한 `exec-out`, PNG 프레임 분할기와 재동기화, input text 이스케이프, 그리고 가짜 툴체인에 대한 호스트 생명주기(스트림, 제어, 유휴 중지, dispose). |
| `node scripts/dev-routes-static-smoke.mjs` | 가짜 호스트에 대한 서명 라우트: 상대 grant, 만료/위조/종류 불일치 토큰, 루프백 펜스, 405/415/400 엔벨로프, 코드화된 기기 거부, `/control` 검증, rotate 형태, 스크린샷 경로 봉쇄, 실시간 multipart 스트림. |
| `node scripts/dev-tools-smoke.mjs` | `createAndroidTools` 이음새를 통한 가짜 호스트 대상 핵심 도구. |
| `node scripts/dev-uitree-smoke.mjs` | UI 트리와 행 도구: `uiautomator` XML 파싱, 셀렉터, 깊이 제한, 행과 카운터 휴리스틱. |
| `node scripts/dev-logs-smoke.mjs` | `android_logs`의 snapshot/follow, 필터, 상한, 프로세스 회수. |
| `node scripts/dev-panel-smoke.mjs` | 패널 컴포넌트, 크기 모드, 프레임 스타일, 도크/트리거/캡슐 로직(SSR만). |
| `node scripts/dev-emulator-smoke.mjs [serial]` | 실제 기기: 첫 프레임, 지속 프레임률, 탭 왕복, dispose. |

## 추가 문제 해결
### 에뮬레이터에서 화면이 흰색/검은색으로만 나올 때

`android_ui_tree`는 실제 UI 요소를 보고 있는데 패널이 완전한 흰색(또는 검은색)
화면만 스트리밍한다면, 이 머신에서 에뮬레이터의 호스트 GPU 프레임버퍼 리드백이
깨진 것입니다(일부 macOS 호스트에서 알려진 gfxstream 문제 — `screencap` 자체가
빈 프레임을 돌려주므로 모든 화면 도구가 영향을 받습니다). 소프트웨어 렌더링으로
에뮬레이터를 다시 실행하세요:

```bash
emulator -avd <name> -gpu swiftshader_indirect
```

또는 해당 AVD의 `config.ini`에 `hw.gpu.mode=swiftshader_indirect`를 설정하세요.
실기기는 이 문제의 영향을 받지 않습니다.

## 로드맵

- **더 높은 프레임률의 소스.** `StreamSource` 이음새는 의도적으로 교체 가능하게 만들었습니다: `scrcpy-server` + WebCodecs H.264 경로라면 라우트도, 도구도, 패널도 건드리지 않고 프레임 단위 PNG 스트림을 대체할 수 있습니다.
- **Compose 미리보기 핫 리로드.** iOS 쌍둥이는 SwiftUI 미리보기를 dylib으로 핫스왑하지만, Compose에는 오늘날 이에 상응하는 핫스왑 프리미티브가 없습니다. 그래서 이 항목은 출시했지만 불안정한 기능이 아니라 미래의 과제로 남겨둡니다.

## 생태계

- [DSH iOS Simulator](https://github.com/ZSeven-W/dsh-ios) — iOS 시뮬레이터와 USB 연결 iPhone을 위한 동일한 아키텍처
- [DSH Crew](https://github.com/ZSeven-W/dsh-crew) — Claude Code / Codex에서 DSH 에이전트로 작업 위임
- [DSH Noema](https://github.com/ZSeven-W/dsh-noema) — DSH를 위한 장기 기억
- [DSH OpenPencil](https://github.com/ZSeven-W/dsh-openpencil) — 대화 안에서 `.op` 디자인 문서 확인 및 편집

## 크레딧 및 라이선스

- [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools) (`adb`) — 런타임에 해석하며 재배포하지 않습니다: Google의 SDK 라이선스가 번들링을 허용하지 않습니다.
- [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) — Senzhk — 비 ASCII 입력을 뒷받침하는 선택적 온디바이스 IME(Apache-2.0; 번들되지 않음).
- 아키텍처와 라우트 보안 태세는 [dsh-ios](https://github.com/ZSeven-W/dsh-ios)와 공유하며, 이 plugin은 그것을 이식한 것입니다.
- 전체 고지 사항은 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)를 참조하세요.

**라이선스**: MIT
