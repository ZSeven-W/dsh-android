<p align="center">
  <img src="./docs/images/dsh-android-logo.png" alt="DSH Android" width="120" />
</p>

<h1 align="center">DSH Android</h1>

<p align="center">
  <strong>Un dispositivo Android en vivo dentro de una conversación de <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a>: emulador o teléfono USB, gobernado por completo a través de adb.</strong><br />
  <sub>20 herramientas de agente &bull; transmisión en vivo generada en el proceso, sin ayudante externo &bull; panel de navegación de tres botones &bull; compilación &amp; ejecución con Gradle &bull; OCR de Vision</sub>
</p>

<p align="center">
  <sub>npm: <code>@zseven-w/dsh-android</code> &middot; Versión actual del plugin: <code>0.1.0-rc.1</code> &middot; Probado con DSH <code>0.1.1-rc.1</code></sub>
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <b>Español</b> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

<br />

<p align="center">
  <img src="./docs/images/dsh-android-overview.png" alt="DSH Android — a live Android device inside the conversation" width="100%" />
</p>
<p align="center"><sub>Un dispositivo Android transmitido y controlado desde dentro de una conversación de DSH: la llamada a la herramienta del agente en el centro, el panel del dispositivo en vivo a la derecha</sub></p>

## Por qué DSH Android

DSH Android le da al agente un dispositivo Android real dentro de la conversación, y a ti te da los píxeles. El agente puede iniciar una transmisión en un emulador o en un teléfono conectado por USB, compilar e instalar un proyecto Gradle, gobernar la interfaz por `resource-id`/texto o por OCR, leer logcat e inspeccionar procesos y memoria, mientras la transmisión en vivo del dispositivo se renderiza en un panel lateral persistente donde puedes tocar, arrastrar, rotar y pulsar Atrás / Inicio / Recientes directamente sobre el vídeo. Sin bloques de imagen y sin archivos de grabación de pantalla: los bytes visuales llegan a la interfaz únicamente a través de URL firmadas y caducas servidas por el servidor web de DSH.

Hay exactamente una ruta de código. `adb devices -l` informa de un **serial**, y ese serial es la única identidad de un dispositivo: `emulator-5554`, un serial USB o un destino `ip:port` se comportan igual. El plugin no está atado a ningún producto de emulación (AVD, Genymotion, WSA, una granja de dispositivos en la nube), y no existe ninguna división simulador/dispositivo real sobre la que razonar.

| | |
| --- | --- |
| 📱 **Dispositivo en vivo en la conversación** | Una transmisión PNG `multipart/x-mixed-replace` producida **en el proceso** y servida directamente desde el búfer del último fotograma mediante rutas firmadas `/_dsh/dsh-android/*`. |
| 🔌 **Sin ayudante de transmisión externo, sin puerto interno** | Un único proceso hijo `adb exec-out` persistente ejecuta `while :; do screencap -p; done`; el host mismo divide los PNG concatenados en fotogramas. No hay servidor de transmisión loopback que proxear, ni rango de puertos que gestionar, ni nada que adoptar tras una salida abrupta. |
| 🧩 **Una sola ruta de código adb** | Para adb, y para este plugin, emuladores y teléfonos son lo mismo. Sin pila doble `simctl`/WebDriverAgent, sin el baile de compilar y confiar antes de que un dispositivo físico funcione. |
| 🛠️ **20 herramientas de agente** | Dispositivos, arranque/apagado, captura de pantalla, interacción, compilación &amp; ejecución con Gradle, listado/lanzamiento de apps, árbol de UI de `uiautomator` + toque por elemento, acciones sobre filas de listas/feeds, buscar/tocar/esperar con OCR de Vision, logcat, procesos, backtrace de ANR/fallo, meminfo, información de la app. |
| 👆 **Panel de navegación de tres botones** | Toca y arrastra sobre el vídeo en vivo; una barra con **◁ Atrás · ○ Inicio · □ Recientes** más rotar, capturar y actualizar; un menú de dispositivo para el panel de notificaciones, los ajustes rápidos, bloquear, despertar y el asistente. |
| 🔐 **Rutas firmadas y solo en loopback** | Cada ruta exige un par en loopback, un `Host` en loopback (se rechaza el DNS rebinding) y comprobaciones Fetch-Metadata/Origin, **antes** de consultar cualquier capacidad. Las capacidades HMAC-SHA256 caducan en 10 minutos. |
| 🔍 **Automatización semántica + visual** | `android_ui_tree` vuelca la jerarquía de `uiautomator` y `android_tap_element` toca por `resource-id`, texto o content-description; cuando el árbol está vacío o el texto viene incrustado en una imagen, `android_find_text` / `android_tap_text` aplican OCR a la pantalla en vez de adivinar coordenadas. |

## Herramientas

Las 20 herramientas se registran en todos los hosts y devuelven JSON plano: los bytes visuales llegan a la interfaz solo mediante `presentationMeta` + rutas firmadas, nunca como bloques de imagen. Cuando adb no puede resolverse, las herramientas siguen registradas y cada llamada falla con un error explicativo que nombra la solución.

Las coordenadas están siempre **normalizadas 0..1 respecto al fotograma transmitido**. El fotograma sigue la rotación de la pantalla (una app en horizontal se transmite a 2400×1080 en un dispositivo de 1080×2400) y `input tap` comparte ese mismo espacio, así que en este plugin no existe ningún cálculo de rotación en el cliente.

### Herramientas principales

| Herramienta | Qué hace | Parámetros clave |
| --- | --- | --- |
| `android_devices` | Lista todos los dispositivos que informa `adb devices -l` (serial, estado, emulador/físico, modelo, versión de Android, nivel de API, nombre del AVD) más los nombres de AVD de la máquina bajo `avds`. Úsala para descubrir el serial que toman las demás herramientas. Una enumeración fallida lanza un error en vez de devolver una lista vacía. | — |
| `android_boot` | Inicia la transmisión en vivo. Pasa un serial ONLINE para transmitirlo de inmediato, o un nombre de AVD para lanzar primero ese emulador y transmitirlo cuando termine de arrancar (minutos en arranque en frío). La transmisión se mantiene viva durante toda la conversación, de modo que el panel puede mostrar el dispositivo en directo. | `device` (obligatorio: un serial o un nombre de AVD) |
| `android_shutdown` | Apaga un emulador (`adb emu kill`) y detiene la transmisión cuando apunta a ese dispositivo. Un dispositivo físico se rechaza con el motivo: adb no puede apagar un teléfono. | `device` |
| `android_screenshot` | Captura un PNG y devuelve un pequeño resumen JSON (ruta, bytes, dimensiones, dispositivo); la imagen se renderiza en la tarjeta y en el panel, nunca como bloque de imagen. | `device` (opcional: el dispositivo en transmisión, si no el único en línea) |
| `android_interact` | Interactúa con el dispositivo en transmisión: toca en coordenadas normalizadas 0..1, escribe texto, pulsa un botón de navegación o de hardware (`back`, `home`, `recents`, `power`, `volume_up`, `volume_down`, `menu`, `enter`, `delete`), envía un gesto de deslizamiento o desplaza. Cuando la acción se asienta (~300 ms), una captura nueva muestra el efecto. | `action` (obligatorio: `tap`/`type`/`button`/`gesture`/`scroll`), `x`/`y`, `text`, `name`, `json`, `device` |
| `android_list_apps` | Lista los paquetes instalados en el dispositivo (`pm list packages`), con el nombre de versión de `dumpsys package` y una etiqueta legible cuando puede resolverse: el nombre de un paquete de terceros no se adivina, así que lístalo o pásale `name` a `android_launch_app`. | `device`, `query` (subcadena sin distinguir mayúsculas, CJK incluido), `include_system` (false por defecto) |
| `android_launch_app` | Lanza una app instalada por `packageName`, o por `name` (una subcadena de etiqueta sin distinguir mayúsculas, resuelta con el mismo listado). Exactamente uno de los dos. `relaunch` fuerza antes la detención de la app. | `packageName` o `name` (exactamente uno), `device`, `relaunch` |
| `android_build_run` | Compila un proyecto Gradle (`./gradlew assembleDebug`), instala el APK de depuración resultante (`adb install -r`) y lo lanza. Una compilación completa tarda minutos; si falla, el resultado lleva la cola de la salida de error de Gradle. | `projectPath` (obligatorio), `device` |

### Herramientas de árbol de UI y de filas (`uiautomator`)

| Herramienta | Qué hace | Parámetros clave |
| --- | --- | --- |
| `android_ui_tree` | Vuelca la jerarquía `uiautomator` de la app en primer plano como nodos: `type` (la cola del nombre de clase), `text`, `contentDesc`, `resourceId`, `bounds` en píxeles, `enabled`, `focused`, con un tope de ~40 KB (se podan los niveles más profundos y se marca `truncated`). | `device`, `max_depth`, `filter` (subcadena sin distinguir mayúsculas sobre text/content-description/resource-id) |
| `android_tap_element` | Toca un elemento por su identidad: `resource_id` coincide con el `resource-id` del nodo; `text` coincide con su texto o su content-description. Primero coincidencia exacta, luego subcadena sin distinguir mayúsculas; los duplicados anidados se colapsan en un único objetivo y una coincidencia ambigua lista hasta 8 candidatos en vez de elegir uno. Los elementos deshabilitados se rechazan. El toque cae en el centro del elemento y, tras ~300 ms, una captura muestra el efecto; si pasas `expect_text` / `expect_gone`, el toque y su verificación se vuelven un solo viaje de ida y vuelta. | `device`, `resource_id`, `text`, `expect_text`, `expect_gone` |
| `android_ui_rows` | Lee una pantalla de lista/feed (`RecyclerView` y compañía) como FILAS en vez de como árbol crudo: los hijos repetidos de la misma forma se convierten en filas con un índice, un marco en píxeles, la etiqueta agregada y los contadores extraídos de esa etiqueta (número + clasificador, en chino o inglés; no se codifica en duro ningún vocabulario de app). Las claves de contador van y vuelven: pasa una exactamente como se lista a `android_tap_row.expect_count`. | `device`, `max_depth` |
| `android_tap_row` | Toca en una posición relativa dentro de una fila visible (`index` de `android_ui_rows`; `x`/`y` como fracciones del marco de esa fila, 0,5 = centro por defecto). El marco procede de una lectura FRESCA del árbol, así que no se adivina ninguna coordenada absoluta, y un índice fuera de rango FALLA en vez de recortarse. Con `expect_count={key, delta}` la herramienta relee la fila tras ~800 ms y verifica que el contador se movió exactamente ±1; una clave desconocida RECHAZA el toque antes de que ocurra. | `device`, `index` (obligatorio), `x`, `y`, `expect_count` (`{key, delta}`) |

### Herramientas de OCR, registros y depuración

| Herramienta | Qué hace | Parámetros clave |
| --- | --- | --- |
| `android_find_text` | Aplica OCR a la pantalla ACTUAL con el ayudante de Vision compilado por el plugin (reconocimiento accurate, zh-Hans + en-US). Úsala cuando el árbol de UI esté vacío o degenerado, para texto renderizado como gráfico (contadores de insignias, precios incrustados en imágenes) o para verificar de forma independiente qué hay en pantalla. Devuelve `{device, size, items:[{text, confidence, rect}]}`, donde los rects son cajas en **píxeles** con origen arriba a la izquierda, ordenadas por confianza y con tope de ~40 KB. Solo en host macOS. | `device`, `query` (subcadena sin distinguir mayúsculas), `min_confidence` (0.3 por defecto) |
| `android_tap_text` | Aplica OCR a la pantalla ACTUAL y toca el centro de la mejor coincidencia de texto: las mismas reglas exactas que `android_tap_element` (exacto → contiene → lista de candidatos), para texto que el árbol de UI no ve. El centro en píxeles de la coincidencia se normaliza respecto al tamaño del fotograma y se envía como toque; tras ~300 ms una captura nueva muestra el efecto. Solo en host macOS. | `device`, `query` (obligatorio), `min_confidence`, `expect_text`, `expect_gone` |
| `android_wait_for` | Espera hasta que un texto aparezca o desaparezca, sondeando el mismo canal de captura + OCR cada 600 ms hasta que la condición se cumpla o venza el tiempo (8 s por defecto, 60 s máximo). Un vencimiento es una respuesta `matched:false` normal, nunca un error. Solo en host macOS. | `device`, `text` (obligatorio), `mode` (`appear`/`disappear`), `timeout_ms`, `min_confidence` |
| `android_logs` | Lee lo que registra el dispositivo: `snapshot` (`logcat -d -v time` sobre una ventana reciente, 2m por defecto) o `follow` (una captura en vivo acotada por `duration_seconds`, 10 por defecto, 60 máximo; nunca una transmisión colgada). Filtra a una sola app con `bundle_id` (el nombre de paquete Android, resuelto a su pid). La salida se limita a ~300 líneas / 30 KB con una pista para acotar. | `device`, `mode` (`snapshot`/`follow`), `duration`, `duration_seconds`, `bundle_id`, `grep` |
| `android_processes` | Lista los procesos en ejecución del dispositivo (`ps -A`) como `{pid, name}`: la fuente de pid para `android_backtrace`. | `device`, `filter` (subcadena sin distinguir mayúsculas sobre el nombre del proceso) |
| `android_backtrace` | Pide al proceso que vuelque sus pilas (`kill -3`) y lee la traza de ANR resultante en `/data/anr/`. La mayoría de dispositivos sin root deniegan ese directorio, así que la herramienta degrada al búfer de fallos (`logcat -b crash -d`) e informa con honestidad de qué motor respondió y de qué no puede ver. | `device`, `pid` o `bundle_id` |
| `android_meminfo` | Analiza `dumpsys meminfo <package>`: PSS total, el desglose Java/nativo/gráficos y las categorías principales: la respuesta de Android a un resumen de fugas. | `device`, `bundle_id` (obligatorio) |
| `android_app_info` | Datos de una app instalada según `dumpsys package <package>`: nombre y código de versión, directorio de datos, ruta del código, fecha de primera instalación e indicador de sistema. Una app ausente devuelve `installed: false` más una nota que nombra `android_list_apps`; no lanza error. | `device`, `bundle_id` (obligatorio) |

## Superficies de visualización

- **Panel lateral.** La vista en vivo vive en un panel derecho persistente (un dock fijo que aparta la conversación, o una superposición centrada en viewports estrechos). Renderiza la transmisión PNG en vivo y acepta clic-para-tocar y arrastrar-para-gesto directamente sobre el vídeo, con una barra que lleva **◁ Atrás**, **○ Inicio**, **□ Recientes**, rotar, capturar y actualizar. Un menú de dispositivo ejecuta las cinco acciones de nivel de dispositivo (panel de notificaciones, ajustes rápidos, bloquear, despertar, asistente). El selector de dispositivos lista todos los dispositivos adb en UNA sola lista, agrupados por tipo, con los AVD sin arrancar mostrados como una pista que apunta a `android_boot` en lugar de arrancarlos al hacer clic. Los modos de tamaño y los estilos de marco (sin marco / bisel / carcasa de teléfono) funcionan igual que en el gemelo de iOS; el panel deduce su relación de aspecto del tamaño natural del propio fotograma, así que una rotación no necesita configuración alguna.
- **Tarjetas de conversación compactas.** Los resultados de las herramientas se renderizan como tarjetas de una línea sin imágenes en línea: el nombre del dispositivo, una subetiqueta de acción, una insignia de estado y una indicación de «abrir en el panel lateral». Al hacer clic en la fila se abre el panel.
- **Cápsula de estado sobre la entrada.** Mientras el panel está cerrado y hay una transmisión en línea, aparece una pequeña píldora sobre el compositor que abre el panel al hacer clic.
- **Modo estándar y modo Code.** Las sesiones estándar usan el `presentationMeta` proyectado por el host; los despachos anidados del modo Code no llevan meta, así que el cliente reconstruye la misma meta a partir del JSON de resultado durable: el panel, las tarjetas y la cápsula funcionan en ambos.

## Seguridad

- **El navegador nunca habla con adb, y no existe ningún puerto interno con el que hablar.** La transmisión se produce en este proceso y se sirve desde memoria; cada byte cruza el origen del servidor web de DSH mediante rutas `/_dsh/dsh-android/*` propiedad del plugin: `/stream/<token>` (PNG multipart en vivo), `/screenshot/<token>` (PNG cacheado), más `/grant`, `/switch-device`, `/devices`, `/capture`, `/status`, `/control` y `/device-action`. Es una superficie de ataque estrictamente menor que la de un servidor de transmisión loopback proxeado.
- **Una triple barrera de loopback, aplicada antes de leer cualquier capacidad.** El par de transporte debe ser una dirección loopback, la cabecera `Host` debe nombrar una autoridad loopback (por lo que se rechaza un `Host` de DNS rebinding) y Fetch-Metadata/`Origin` deben ser del mismo origen. Host y Origin son datos controlados por quien llama y nunca se creen por sí solos.
- **Capacidades HMAC-SHA256 que caducan en 10 minutos**, con formato `base64url(payload).base64url(mac)` y firmadas con una clave de 32 bytes propia de cada hogar DSH (`<DSH_HOME>/cache/dsh-android/stream-access.key`, modo 0600, creada de forma atómica). Una capacidad emitida para un dispositivo deja de funcionar en el momento en que otro dispositivo toma la ranura de transmisión, y una capacidad de captura no puede reproducirse contra la ruta de transmisión.
- **La ruta de capturas sirve exactamente un directorio.** Las rutas se recorren con `lstat` (cualquier enlace simbólico se rechaza), se rematan con una comprobación de contención por `realpath`, se abren con `O_NOFOLLOW`, se acotan en tamaño y se revalidan tras la lectura, de modo que un archivo sustituido por un enlace simbólico entre la emisión y la descarga nunca llega a servirse.
- **`/grant` nunca arranca nada.** Solo inicia el bucle de fotogramas de un dispositivo que ya está en línea, y rechaza (409 `device_busy`) arrebatar la transmisión a otro dispositivo. Cambiar de dispositivo exige el gesto explícito `/switch-device`; arrancar un AVD sigue siendo cosa de la herramienta `android_boot`.
- **Keep-alive y parada por inactividad.** Un bucle de fotogramas caído se reinicia en segundo plano (~5 s de retardo); con cero consumidores, la transmisión se detiene sola a los 5 minutos. Las paradas intencionadas nunca se combaten.

## Requisitos

- **Node ≥ 24.11.0.**
- **adb**, de las platform-tools del SDK de Android, resuelto en este orden: la variable de entorno `ADB` → `adb` en el `PATH` → `<ANDROID_HOME>`/`<ANDROID_SDK_ROOT>`/la raíz del SDK por defecto de cada sistema + `/platform-tools/adb`. Instálalo con `sdkmanager "platform-tools"`, con Android Studio o con `brew install --cask android-platform-tools`. Sin adb el plugin se carga igualmente y las 20 herramientas se registran; cada llamada explica entonces qué falta.
- **Un dispositivo**: un emulador de cualquier producto, o un teléfono con la depuración USB activada. El lanzador `emulator` es opcional y solo lo necesita `android_boot` por nombre de AVD; todo lo demás funciona con lo que adb pueda ver.
- **DSH ≥ 0.1.0-rc.6 con el bundle web** para el panel. Los perfiles headless también funcionan: las 20 herramientas operan con normalidad, solo que sin la vista en vivo.
- **Host macOS para el OCR** (solo lo necesitan `android_find_text` / `android_tap_text` / `android_wait_for`): en el primer uso, el plugin compila su `assets/ocr.swift` incluido con `swiftc` en `~/Library/Caches/dsh-android/bin/ocr`. En hosts Linux y Windows esas tres herramientas informan de que el OCR necesita el framework Vision de macOS; las otras 17 no se ven afectadas. Sobrescrituras: `DSH_ANDROID_OCR_DIR`, `DSH_ANDROID_OCR_SWIFT`, `DSH_ANDROID_SWIFTC`.
- **ADBKeyboard** (opcional, para escritura CJK y emoji): `adb shell input text` solo admite ASCII. Instala [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) en el dispositivo y selecciónalo como IME activo, y el texto no ASCII se entregará por su interfaz de broadcast. Sin él, escribir texto no ASCII se RECHAZA con la pista de instalación, nunca se teclea mal en silencio.

## Dispositivos físicos

No hay ningún equivalente de WebDriverAgent que compilar, firmar, aprobar ni volver a firmar cada siete días. Activa la depuración USB, conecta el teléfono, acepta el aviso de autorización en el dispositivo y aparecerá en `android_devices` con todas las herramientas funcionando contra él. Un dispositivo no autorizado se informa como tal, con la pista sobre el aviso, y no como un fallo misterioso.

Tres salvedades honestas:

- **La tasa de fotogramas es menor por USB**: unos 2–5 fps contra un teléfono frente a 5–10 fps en un emulador, porque cada fotograma cruza el enlace USB como PNG completo.
- **Escribir CJK necesita ADBKeyboard** (ver arriba); esto afecta por igual a emuladores y teléfonos.
- **`android_shutdown` no puede apagar un teléfono.** adb no tiene ese verbo; la herramienta lo dice en vez de fingir.

## Rendimiento

Medido en un emulador (Android 14, 1080×2400):

| | |
| --- | --- |
| Bucle screencap persistente | ≈ 8 fps |
| Primer fotograma de `ensureStreaming` | ~200 ms |
| Ida y vuelta de `input tap` | ~130 ms |

Lo que compra estas cifras es el único proceso hijo persistente: lanzar un `adb` por fotograma cuesta ~50–100 ms antes de que se mueva un solo píxel. Espera ~5–10 fps en un emulador y ~2–5 fps en un teléfono USB, según la máquina y la densidad de pantalla.

## Instalar en DSH

```sh
dsh plugin --profile web add @zseven-w/dsh-android@latest
dsh web
```

O añádelo como dependencia de un paquete de perfil existente:

```sh
pnpm add @zseven-w/dsh-android
```

## Inicio rápido

1. **Descubrir dispositivos**: «Lista los dispositivos Android.» → `android_devices`.
2. **Iniciar la transmisión**: «Transmite emulator-5554.» → `android_boot`. El panel se abre con el dispositivo en vivo. (Un nombre de AVD arranca primero ese emulador.)
3. **Tocar sobre el vídeo**: toca o arrastra directamente en el panel, o deja que conduzca el agente: «Abre Ajustes y toca Pantalla.» → `android_interact`, o `android_ui_tree` + `android_tap_element` para toques por identidad, o `android_find_text` + `android_tap_text` cuando el árbol está ciego.
4. **Compilar y ejecutar tu app**: «Compila y ejecuta /path/to/MyApp.» → `android_build_run`. Una compilación completa de Gradle tarda minutos; cuando aterriza, la app se lanza y la ves en vivo en el panel.
5. **Leer los registros**: «Muestra los últimos dos minutos de logcat de com.example.app.» → `android_logs`.

## Solución de problemas

- **Todas las herramientas dicen que adb no está disponible**: el error nombra los tres niveles de resolución. Define `ADB=/ruta/a/adb`, pon `adb` en el `PATH` o instala las platform-tools del SDK (`sdkmanager "platform-tools"`).
- **El dispositivo está `unauthorized`**: acepta el aviso de depuración USB en la pantalla del dispositivo. `android_devices` informa del estado con honestidad en vez de ocultar el dispositivo.
- **`android_boot` no encuentra un AVD**: no se pudo localizar el lanzador `emulator`. Arranca el emulador por cualquier medio; aparecerá en `android_devices` en cuanto adb lo vea, y `android_boot` tomará entonces su serial.
- **Se rechaza el texto no ASCII**: instala ADBKeyboard y selecciónalo como método de entrada (ver Requisitos). El rechazo es deliberado: `input text` descartaría o estropearía los caracteres en silencio.
- **`android_find_text` dice que el OCR no está disponible**: el OCR necesita un host macOS (el framework Vision de Apple). Las 17 herramientas sin OCR funcionan en todas partes.
- **La transmisión se detiene sola**: eso es la política de inactividad, no un fallo: con cero consumidores (panel cerrado, ninguna tarjeta montada, ninguna ruta activa) la transmisión se detiene a los 5 minutos y se reinicia en la siguiente llamada a una herramienta o al abrir el panel. Un bucle caído se reinicia solo en ~5 segundos.
- **La rotación se ve mal en el launcher**: los launchers y Ajustes se fijan en vertical e ignoran `user_rotation`. Es comportamiento normal de Android, no un fallo del plugin; rota dentro de una app que lo permita.

## Desarrollo

```sh
pnpm install
pnpm run build      # tsc del host + bundle del cliente → lib/
pnpm run typecheck
pnpm test           # todas las suites estáticas; no hace falta dispositivo
```

Las suites de smoke de `scripts/` ejercitan el `lib/` compilado. Todas son estáticas salvo `dev-emulator-smoke.mjs`, que necesita un dispositivo e informa SKIP (código de salida 0) cuando no hay ninguno.

| Script | Qué cubre |
| --- | --- |
| `node scripts/dev-adb-smoke.mjs` | La resolución de adb (env / PATH / SDK) contra un binario simulado, el parseo de `devices -l`, un `exec-out` seguro para binarios, el divisor de fotogramas PNG y su resincronización, el escapado de input text y el ciclo de vida del host (transmisión, control, parada por inactividad, dispose) contra una cadena de herramientas falsa. |
| `node scripts/dev-routes-static-smoke.mjs` | Las rutas firmadas contra un host falso: grants relativos, tokens caducados/falsificados/de otro tipo, la barrera de loopback, los sobres 405/415/400, los rechazos de dispositivo codificados, la validación de `/control`, la forma de rotate, la contención de capturas y la transmisión multipart en vivo. |
| `node scripts/dev-tools-smoke.mjs` | Las herramientas principales contra un host falso a través de la costura `createAndroidTools`. |
| `node scripts/dev-uitree-smoke.mjs` | Herramientas de árbol de UI y de filas: parseo del XML de `uiautomator`, selectores, tope de profundidad, heurísticas de filas y contadores. |
| `node scripts/dev-logs-smoke.mjs` | `android_logs` snapshot/follow, filtros, topes y recolección de procesos. |
| `node scripts/dev-panel-smoke.mjs` | Componentes del panel, modos de tamaño, estilos de marco, lógica de dock/disparador/cápsula (solo SSR). |
| `node scripts/dev-emulator-smoke.mjs [serial]` | Dispositivo real: primer fotograma, tasa de fotogramas sostenida, ida y vuelta de un toque, dispose. |

## Otros problemas conocidos
### Transmisión en blanco / negro en un emulador

Si el panel transmite una imagen completamente blanca (o negra) mientras
`android_ui_tree` sigue viendo elementos de UI reales, en tu máquina está roto el
readback del framebuffer por la GPU del host del emulador (un problema conocido de
gfxstream en algunos hosts macOS: el propio `screencap` devuelve fotogramas en
blanco, así que todas las herramientas de pantalla se ven afectadas). Relanza el
emulador con renderizado por software:

```bash
emulator -avd <name> -gpu swiftshader_indirect
```

o define `hw.gpu.mode=swiftshader_indirect` en el `config.ini` del AVD. Los
dispositivos físicos nunca se ven afectados.

## Hoja de ruta

- **Una fuente con mayor tasa de fotogramas.** La costura `StreamSource` es deliberadamente intercambiable: una vía `scrcpy-server` + WebCodecs H.264 sustituiría la transmisión PNG fotograma a fotograma sin tocar las rutas, las herramientas ni el panel.
- **Recarga en caliente de vistas previas de Compose.** El gemelo de iOS intercambia en caliente las vistas previas de SwiftUI como dylib; Compose no tiene hoy una primitiva de intercambio en caliente equivalente, así que esto queda como asunto futuro en vez de como algo entregado e inestable.

## Ecosistema

- [DSH iOS Simulator](https://github.com/ZSeven-W/dsh-ios) — la misma arquitectura para el simulador de iOS y los iPhone conectados por USB
- [DSH Crew](https://github.com/ZSeven-W/dsh-crew) — delegar trabajo a agentes DSH desde Claude Code / Codex
- [DSH Noema](https://github.com/ZSeven-W/dsh-noema) — memoria a largo plazo para DSH
- [DSH OpenPencil](https://github.com/ZSeven-W/dsh-openpencil) — inspeccionar y editar documentos `.op` dentro de una conversación

## Créditos &amp; Licencia

- [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools) (`adb`) — se resuelven en tiempo de ejecución y nunca se redistribuyen: la licencia del SDK de Google no permite incluirlas.
- [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) — Senzhk — el IME opcional en el dispositivo detrás de la escritura no ASCII (Apache-2.0; no incluido).
- Arquitectura y postura de seguridad de las rutas compartidas con [dsh-ios](https://github.com/ZSeven-W/dsh-ios), de donde se ha portado este plugin.
- Consulta [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) para los avisos completos.

**Licencia**: MIT
