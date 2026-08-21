<p align="center">
  <img src="./docs/images/dsh-android-logo.png" alt="DSH Android" width="120" />
</p>

<h1 align="center">DSH Android</h1>

<p align="center">
  <strong>Ein Live-Android-Gerät mitten in einer <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek-Harness</a>-Konversation — Emulator oder USB-Telefon, vollständig über adb gesteuert.</strong><br />
  <sub>20 Agenten-Tools &bull; Live-Stream im Prozess erzeugt, ohne externen Helper &bull; Drei-Tasten-Navigationspanel &bull; Gradle-Build &amp; -Run &bull; Vision-OCR</sub>
</p>

<p align="center">
  <sub>npm: <code>@zseven-w/dsh-android</code> &middot; Aktuelles Plugin-Release: <code>0.1.0-rc.2</code> &middot; Getestet mit DSH <code>0.1.1-rc.1</code></sub>
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <b>Deutsch</b> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

<br />

<p align="center">
  <img src="./docs/images/dsh-android-overview.png" alt="DSH Android — a live Android device inside the conversation" width="100%" />
</p>
<p align="center"><sub>Ein Android-Gerät, gestreamt und gesteuert aus einer DSH-Konversation heraus — in der Mitte der Tool-Aufruf des Agenten, rechts das Live-Gerätepanel</sub></p>

## Warum DSH Android

DSH Android gibt dem Agenten ein echtes Android-Gerät in der Konversation — und Ihnen die Pixel. Der Agent kann einen Stream auf einem Emulator oder einem per USB angeschlossenen Telefon starten, ein Gradle-Projekt bauen und installieren, die Oberfläche per `resource-id`/Text oder per OCR bedienen, logcat lesen sowie Prozesse und Speicher inspizieren, während der Live-Stream des Geräts in einem persistenten Seitenleisten-Panel gerendert wird, in dem Sie direkt auf dem Video tippen, ziehen, drehen und Zurück / Startseite / Übersicht drücken können. Keine Bildblöcke und keine Bildschirmaufnahmedateien: Sichtbare Bytes erreichen die Oberfläche ausschließlich über signierte, kurzlebige URLs, die der DSH-Webserver ausliefert.

Es gibt genau einen Codepfad. `adb devices -l` meldet ein **Serial**, und dieses Serial ist die einzige Identität eines Geräts — `emulator-5554`, ein USB-Serial oder ein `ip:port`-Ziel verhalten sich völlig gleich. Das Plugin ist an kein Emulator-Produkt gebunden (AVD, Genymotion, WSA, eine Cloud-Gerätefarm), und es gibt keine Trennung zwischen Simulator und echtem Gerät, über die man nachdenken müsste.

| | |
| --- | --- |
| 📱 **Live-Gerät in der Konversation** | Ein `multipart/x-mixed-replace`-PNG-Stream, **im Prozess** erzeugt und direkt aus dem Puffer des jüngsten Frames über signierte `/_dsh/dsh-android/*`-Routen ausgeliefert. |
| 🔌 **Kein externer Stream-Helper, kein innerer Port** | Ein einziger persistenter `adb exec-out`-Kindprozess führt `while :; do screencap -p; done` aus; der Host zerlegt die aneinandergehängten PNGs selbst in Frames. Es gibt keinen Loopback-Streamserver zu proxen, keinen Portbereich zu verwalten und nach einem harten Abbruch nichts zu übernehmen. |
| 🧩 **Ein adb-Codepfad** | Für adb wie für dieses Plugin sind Emulatoren und Telefone dasselbe. Kein `simctl`/WebDriverAgent-Doppelstack, kein Bauen-und-Vertrauen-Tanz, bevor ein physisches Gerät funktioniert. |
| 🛠️ **20 Agenten-Tools** | Geräte, Start/Herunterfahren, Screenshot, Interaktion, Gradle-Build &amp; -Run, App-Auflistung/-Start, `uiautomator`-UI-Tree + Tippen per Element, Zeilenaktionen für Listen/Feeds, Vision-OCR Finden/Tippen/Warten, logcat, Prozesse, ANR-/Crash-Backtrace, meminfo, App-Infos. |
| 👆 **Drei-Tasten-Navigationspanel** | Tippen und Ziehen auf dem Live-Video; eine Symbolleiste mit **◁ Zurück · ○ Startseite · □ Übersicht** plus Drehen, Screenshot und Aktualisieren; ein Gerätemenü für Benachrichtigungsleiste, Schnelleinstellungen, Sperren, Aufwecken und Assistent. |
| 🖼️ **Nativ multimodal** | Bei einem bildfähigen Modell liefert jedes Aufnahme-Tool (screenshot, interact, tap_element, tap_text, tap_row) den Screenshot SELBST als image block zurück — das Modell sieht den Bildschirm direkt. OCR bleibt für pixelgenaue Text-Taps und reine Text-Routen; Modelle ohne Bildunterstützung erhalten weiterhin die schlichte JSON-Zusammenfassung. |
| 🔐 **Signierte Routen, nur über Loopback** | Jede Route verlangt einen Loopback-Peer, einen Loopback-`Host` (DNS-Rebinding wird abgelehnt) und Fetch-Metadata-/Origin-Prüfungen — **bevor** irgendeine Capability geprüft wird. HMAC-SHA256-Capabilities laufen innerhalb von 10 Minuten ab. |
| 🔍 **Semantische + visuelle Automatisierung** | `android_ui_tree` gibt die `uiautomator`-Hierarchie aus und `android_tap_element` tippt per `resource-id`, Text oder Content-Description; ist der Baum leer oder der Text ins Bild eingebrannt, führen `android_find_text` / `android_tap_text` stattdessen OCR auf dem Bildschirm aus, statt Koordinaten zu raten. |

## Tools

Alle 20 Tools werden auf jedem Host registriert und liefern schlichtes JSON — sichtbare Bytes erreichen die Oberfläche nur über `presentationMeta` + signierte Routen, niemals als Bildblöcke. Lässt sich adb nicht auflösen, bleiben die Tools registriert und jeder Aufruf schlägt mit einem erklärenden Fehler fehl, der die Lösung benennt.

Koordinaten sind überall **auf 0..1 des gestreamten Frames normalisiert**. Der Frame folgt der Displaydrehung (eine Querformat-App streamt auf einem 1080×2400-Gerät als 2400×1080), und `input tap` teilt sich denselben Raum — deshalb existiert in diesem Plugin nirgends eine clientseitige Rotationsrechnung.

### Kern-Tools

| Tool | Funktion | Wichtige Parameter |
| --- | --- | --- |
| `android_devices` | Listet jedes von `adb devices -l` gemeldete Gerät (Serial, Zustand, Emulator/physisch, Modell, Android-Version, API-Level, AVD-Name) sowie die AVD-Namen der Maschine unter `avds`. Damit finden Sie das Serial, das die anderen Tools erwarten. Eine fehlgeschlagene Aufzählung wirft einen Fehler, statt eine leere Liste zurückzugeben. | — |
| `android_boot` | Startet den Live-Stream. Übergeben Sie ein ONLINE-Serial, um es sofort zu streamen, oder einen AVD-Namen, um diesen Emulator zuerst zu starten und ihn nach dem Hochfahren zu streamen (bei Kaltstart Minuten). Der Stream bleibt für die gesamte Konversation aktiv, damit das Panel das Gerät live zeigen kann. | `device` (erforderlich — ein Serial oder ein AVD-Name) |
| `android_shutdown` | Fährt einen Emulator herunter (`adb emu kill`) und stoppt den Stream, wenn er auf dieses Gerät zeigt. Ein physisches Gerät wird mit Begründung abgelehnt: adb kann ein Telefon nicht ausschalten. | `device` |
| `android_screenshot` | Nimmt ein PNG auf und liefert eine kleine JSON-Zusammenfassung (Pfad, Bytes, Abmessungen, Gerät); das Bild wird in der Karte und im Panel gerendert, niemals als Bildblock. | `device` (optional — das gestreamte Gerät, sonst das einzige online befindliche) |
| `android_interact` | Interagiert mit dem gestreamten Gerät: Tippen an normalisierten 0..1-Koordinaten, Text eingeben, eine Navigations- oder Hardwaretaste drücken (`back`, `home`, `recents`, `power`, `volume_up`, `volume_down`, `menu`, `enter`, `delete`), eine Wischgeste senden oder scrollen. Nachdem sich die Aktion gesetzt hat (~300 ms), zeigt ein frischer Screenshot die Wirkung. | `action` (erforderlich — `tap`/`type`/`button`/`gesture`/`scroll`), `x`/`y`, `text`, `name`, `json`, `device` |
| `android_list_apps` | Listet die auf dem Gerät installierten Pakete (`pm list packages`) mit dem Versionsnamen aus `dumpsys package` und, sofern auflösbar, einer lesbaren Bezeichnung — der Paketname einer Drittanbieter-App lässt sich nicht erraten, also listen Sie ihn auf oder übergeben Sie `name` an `android_launch_app`. | `device`, `query` (Teilstring ohne Groß-/Kleinschreibung, CJK inklusive), `include_system` (Standard false) |
| `android_launch_app` | Startet eine installierte App per `packageName` oder per `name` (ein Teilstring der Bezeichnung ohne Groß-/Kleinschreibung, über dieselbe Auflistung aufgelöst). Genau eines von beiden. `relaunch` erzwingt zuvor das Beenden der App. | `packageName` oder `name` (genau eines), `device`, `relaunch` |
| `android_build_run` | Baut ein Gradle-Projekt (`./gradlew assembleDebug`), installiert das entstandene Debug-APK (`adb install -r`) und startet es. Ein vollständiger Build dauert Minuten; bei einem Fehlschlag trägt das Ergebnis das Ende der Gradle-Fehlerausgabe. | `projectPath` (erforderlich), `device` |

### UI-Tree- und Zeilen-Tools (`uiautomator`)

| Tool | Funktion | Wichtige Parameter |
| --- | --- | --- |
| `android_ui_tree` | Gibt die `uiautomator`-Hierarchie der Vordergrund-App als Knoten aus — `type` (das Ende des Klassennamens), `text`, `contentDesc`, `resourceId`, `bounds` in Pixeln, `enabled`, `focused` — begrenzt auf ~40 KB (die tiefsten Ebenen werden beschnitten und `truncated` gesetzt). | `device`, `max_depth`, `filter` (Teilstring ohne Groß-/Kleinschreibung über Text/Content-Description/Resource-ID) |
| `android_tap_element` | Tippt ein Element per Identität an — `resource_id` trifft die `resource-id` des Knotens, `text` seinen Text oder seine Content-Description. Zuerst exakte Übereinstimmung, dann Teilstring ohne Groß-/Kleinschreibung; verschachtelte Duplikate werden zu einem Ziel zusammengefasst, und bei Mehrdeutigkeit werden bis zu 8 Kandidaten aufgelistet, statt eines auszuwählen. Deaktivierte Elemente werden abgelehnt. Der Tipp landet in der Elementmitte, danach zeigt ein Screenshot nach ~300 ms die Wirkung; mit `expect_text` / `expect_gone` werden Tipp und Prüfung zu einem einzigen Umlauf. | `device`, `resource_id`, `text`, `expect_text`, `expect_gone` |
| `android_ui_rows` | Liest einen Listen-/Feed-Bildschirm (`RecyclerView` und Verwandte) als ZEILEN statt als rohen Baum: wiederholte, gleich geformte Kinder werden zu Zeilen mit Index, Pixelrahmen, aggregierter Beschriftung und den aus dieser Beschriftung geparsten Zählern (Zahl + Klassifikator, chinesisch oder englisch — kein App-Vokabular ist fest verdrahtet). Zählerschlüssel sind umlauffähig: Übergeben Sie einen exakt so, wie er gelistet ist, an `android_tap_row.expect_count`. | `device`, `max_depth` |
| `android_tap_row` | Tippt an eine relative Position innerhalb einer sichtbaren Zeile (`index` aus `android_ui_rows`; `x`/`y` als Anteile des Rahmens dieser Zeile, Standard 0,5 = Mitte). Der Rahmen stammt aus einem FRISCHEN Baumabruf, es werden also keine absoluten Koordinaten geraten, und ein Index außerhalb des Bereichs SCHLÄGT FEHL, statt begrenzt zu werden. Mit `expect_count={key, delta}` liest das Tool die Zeile nach ~800 ms erneut und prüft, ob sich der Zähler um genau ±1 bewegt hat; ein unbekannter Schlüssel VERWEIGERT den Tipp, bevor er passiert. | `device`, `index` (erforderlich), `x`, `y`, `expect_count` (`{key, delta}`) |

### OCR-, Log- und Debug-Tools

| Tool | Funktion | Wichtige Parameter |
| --- | --- | --- |
| `android_find_text` | Führt OCR auf dem AKTUELLEN Bildschirm mit dem vom Plugin kompilierten Vision-Helper aus (accurate-Erkennung, zh-Hans + en-US). Nutzen Sie es, wenn der UI-Tree leer oder unbrauchbar ist, für als Grafik gerenderten Text (Badge-Zahlen, in Bilder eingebrannte Preise) oder um unabhängig zu prüfen, was auf dem Bildschirm steht. Liefert `{device, size, items:[{text, confidence, rect}]}`, wobei die Rects **Pixel**-Boxen mit Ursprung oben links sind, nach Konfidenz sortiert und bei ~40 KB gekappt. Nur auf macOS-Hosts. | `device`, `query` (Teilstring ohne Groß-/Kleinschreibung), `min_confidence` (Standard 0.3) |
| `android_tap_text` | Führt OCR auf dem AKTUELLEN Bildschirm aus und tippt die Mitte der besten Textübereinstimmung an — mit exakt denselben Regeln wie `android_tap_element` (exakt → enthält → Kandidatenliste), für Text, den der UI-Tree nicht sieht. Die getroffene Pixelmitte wird gegen die Framegröße normalisiert und als Tipp gesendet; nach ~300 ms zeigt ein frischer Screenshot die Wirkung. Nur auf macOS-Hosts. | `device`, `query` (erforderlich), `min_confidence`, `expect_text`, `expect_gone` |
| `android_wait_for` | Wartet, bis Text erscheint oder verschwindet, und pollt dieselbe Capture-+-OCR-Pipeline alle 600 ms, bis die Bedingung erfüllt ist oder das Zeitlimit abläuft (Standard 8 s, maximal 60 s). Ein Zeitüberschreiten ist eine normale `matched:false`-Antwort, niemals ein Fehler. Nur auf macOS-Hosts. | `device`, `text` (erforderlich), `mode` (`appear`/`disappear`), `timeout_ms`, `min_confidence` |
| `android_logs` | Liest, was das Gerät protokolliert: `snapshot` (`logcat -d -v time` über ein jüngstes Fenster, Standard 2m) oder `follow` (eine begrenzte Live-Aufzeichnung über `duration_seconds`, Standard 10, maximal 60 — niemals ein hängender Stream). Mit `bundle_id` (dem Android-Paketnamen, aufgelöst zu seiner pid) filtern Sie auf eine App. Die Ausgabe ist auf ~300 Zeilen / 30 KB begrenzt und trägt einen Hinweis zum Eingrenzen. | `device`, `mode` (`snapshot`/`follow`), `duration`, `duration_seconds`, `bundle_id`, `grep` |
| `android_processes` | Listet die laufenden Prozesse des Geräts (`ps -A`) als `{pid, name}` — die pid-Quelle für `android_backtrace`. | `device`, `filter` (Teilstring ohne Groß-/Kleinschreibung über den Prozessnamen) |
| `android_backtrace` | Fordert den Prozess auf, seine Stacks zu schreiben (`kill -3`), und liest den entstandenen ANR-Trace aus `/data/anr/`. Die meisten Geräte ohne Root verweigern dieses Verzeichnis, weshalb das Tool auf den Crash-Puffer (`logcat -b crash -d`) zurückfällt und ehrlich meldet, welche Engine geantwortet hat und was sie nicht sehen kann. | `device`, `pid` oder `bundle_id` |
| `android_meminfo` | Wertet `dumpsys meminfo <package>` aus: Gesamt-PSS, die Aufteilung in Java/Native/Graphics und die größten Kategorien — die Android-Antwort auf eine Leak-Zusammenfassung. | `device`, `bundle_id` (erforderlich) |
| `android_app_info` | Fakten zu einer installierten App aus `dumpsys package <package>`: Versionsname und -code, Datenverzeichnis, Codepfad, Zeitpunkt der Erstinstallation und das System-Flag. Eine fehlende App liefert `installed: false` plus einen Hinweis auf `android_list_apps` — sie wirft keinen Fehler. | `device`, `bundle_id` (erforderlich) |

## Anzeigeflächen

- **Seitenleisten-Panel.** Die Live-Ansicht lebt in einem persistenten Panel auf der rechten Seite (ein festes Dock, das die Konversation beiseiteschiebt, oder ein zentriertes Overlay bei schmalen Viewports). Es rendert den Live-PNG-Stream und nimmt Klick-zum-Tippen sowie Ziehen-für-Gesten direkt auf dem Video entgegen, mit einer Symbolleiste für **◁ Zurück**, **○ Startseite**, **□ Übersicht**, Drehen, Screenshot und Aktualisieren. Ein Gerätemenü führt die fünf Aktionen auf Geräteebene aus (Benachrichtigungsleiste, Schnelleinstellungen, Sperren, Aufwecken, Assistent). Die Geräteauswahl listet alle adb-Geräte in EINER Liste, nach Art gruppiert, wobei nicht laufende AVDs als Hinweis auf `android_boot` erscheinen statt beim Klick zu starten. Größenmodi und Rahmenstile (rahmenlos / Rahmen / Telefonhülle) funktionieren wie im iOS-Zwilling; das Panel leitet sein Seitenverhältnis aus der natürlichen Größe des Frames ab, sodass eine Drehung keinerlei Konfiguration braucht.
- **Kompakte Konversationskarten.** Tool-Ergebnisse werden als einzeilige Karten ohne Inline-Bilder gerendert: der Gerätename, ein Aktions-Unterlabel, ein Status-Badge und ein Hinweis „in der Seitenleiste öffnen“. Ein Klick auf die Zeile öffnet das Panel.
- **Status-Kapsel über dem Eingabefeld.** Solange das Panel geschlossen und ein Stream online ist, erscheint über dem Eingabefeld eine kleine Pille, die beim Klick das Panel öffnet.
- **Standardmodus und Code Mode.** Standard-Sitzungen verwenden das vom Host projizierte `presentationMeta`; Dispatches im verschachtelten Code Mode tragen keine Meta, daher rekonstruiert der Client die identische Meta aus dem persistenten Ergebnis-JSON — Panel, Karten und Kapsel funktionieren in beiden Fällen.

## Sicherheit

- **Der Browser spricht nie mit adb, und es gibt gar keinen inneren Port, mit dem er sprechen könnte.** Der Stream entsteht in diesem Prozess und wird aus dem Speicher ausgeliefert; jedes Byte passiert den DSH-Webserver-Ursprung über plugin-eigene `/_dsh/dsh-android/*`-Routen: `/stream/<token>` (Live-Multipart-PNG), `/screenshot/<token>` (gecachtes PNG) sowie `/grant`, `/switch-device`, `/devices`, `/capture`, `/status`, `/control` und `/device-action`. Das ist eine strikt kleinere Angriffsfläche als ein geproxter Loopback-Streamserver.
- **Eine dreifache Loopback-Absicherung, angewendet vor jedem Lesen einer Capability.** Der Transport-Peer muss eine Loopback-Adresse sein, der `Host`-Header muss eine Loopback-Autorität benennen (ein DNS-Rebinding-`Host` wird also abgelehnt), und Fetch-Metadata/`Origin` müssen gleicher Herkunft sein. Host und Origin sind vom Aufrufer kontrollierte Daten und werden nie für sich allein geglaubt.
- **HMAC-SHA256-Capabilities, die innerhalb von 10 Minuten ablaufen**, im Format `base64url(payload).base64url(mac)` und signiert mit einem 32-Byte-Schlüssel pro DSH-Home (`<DSH_HOME>/cache/dsh-android/stream-access.key`, Modus 0600, atomar erzeugt). Eine für ein Gerät ausgestellte Capability verliert ihre Wirkung in dem Moment, in dem ein anderes Gerät den Stream-Slot übernimmt, und eine Screenshot-Capability lässt sich nicht gegen die Stream-Route wiedergeben.
- **Die Screenshot-Route liefert genau ein Verzeichnis aus.** Pfade werden mit `lstat` abgelaufen (jeder Symlink wird abgelehnt), mit einer `realpath`-Einschlussprüfung abgeschlossen, mit `O_NOFOLLOW` geöffnet, in der Größe begrenzt und nach dem Lesen erneut validiert — eine Datei, die zwischen Ausstellung und Abruf gegen einen Symlink getauscht wurde, wird also nie ausgeliefert.
- **`/grant` startet niemals etwas.** Es startet lediglich die Frame-Schleife für ein bereits online befindliches Gerät und weigert sich (409 `device_busy`), den Stream einem anderen Gerät zu entreißen. Ein Gerätewechsel erfordert die explizite `/switch-device`-Geste; das Starten eines AVD bleibt Sache des Tools `android_boot`.
- **Keep-alive und Leerlauf-Stopp.** Eine abgestürzte Frame-Schleife startet im Hintergrund neu (~5 s Verzögerung); ohne Konsumenten stoppt sich der Stream nach 5 Minuten selbst. Absichtliche Stopps werden niemals bekämpft.

## Voraussetzungen

- **Node ≥ 24.11.0.**
- **adb** aus den Android-SDK-Platform-Tools, aufgelöst in dieser Reihenfolge: die Umgebungsvariable `ADB` → `adb` im `PATH` → `<ANDROID_HOME>`/`<ANDROID_SDK_ROOT>`/das betriebssystemübliche Standard-SDK-Root + `/platform-tools/adb`. Installieren Sie es mit `sdkmanager "platform-tools"`, mit Android Studio oder mit `brew install --cask android-platform-tools`. Ohne adb lädt das Plugin trotzdem und alle 20 Tools registrieren sich; jeder Aufruf erklärt dann, was fehlt.
- **Ein Gerät**: ein Emulator beliebigen Produkts oder ein Telefon mit aktiviertem USB-Debugging. Der `emulator`-Launcher ist optional und wird nur für `android_boot` per AVD-Namen gebraucht — alles andere funktioniert mit dem, was adb sieht.
- **DSH ≥ 0.1.0-rc.6 mit dem Web-Bundle** für das Panel. Headless-Profile funktionieren ebenfalls: Alle 20 Tools arbeiten normal, nur ohne Live-Ansicht.
- **macOS-Host für OCR** (nur `android_find_text` / `android_tap_text` / `android_wait_for` brauchen ihn): Das Plugin kompiliert beim ersten Gebrauch sein mitgeliefertes `assets/ocr.swift` mit `swiftc` nach `~/Library/Caches/dsh-android/bin/ocr`. Auf Linux- und Windows-Hosts melden diese drei Tools, dass OCR das Vision-Framework von macOS benötigt; die anderen 17 sind nicht betroffen. Overrides: `DSH_ANDROID_OCR_DIR`, `DSH_ANDROID_OCR_SWIFT`, `DSH_ANDROID_SWIFTC`.
- **ADBKeyboard** (optional, für CJK- und Emoji-Eingabe): `adb shell input text` beherrscht nur ASCII. Installieren Sie [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) auf dem Gerät und wählen Sie es als aktive IME, dann wird Nicht-ASCII-Text über dessen Broadcast-Schnittstelle zugestellt. Ohne es wird Nicht-ASCII-Eingabe mit dem Installationshinweis ABGELEHNT — niemals stillschweigend verstümmelt.

## Physische Geräte

Es gibt kein WebDriverAgent-Äquivalent, das gebaut, signiert, als vertrauenswürdig eingestuft und alle sieben Tage neu signiert werden müsste. Aktivieren Sie USB-Debugging, stecken Sie das Telefon an, bestätigen Sie die Autorisierungsabfrage auf dem Gerät — und es erscheint in `android_devices`, wobei jedes Tool damit arbeitet. Ein nicht autorisiertes Gerät wird genau so gemeldet, samt Hinweis auf die Abfrage, und nicht als rätselhafter Fehlschlag.

Drei ehrliche Einschränkungen:

- **Über USB ist die Bildrate niedriger** — grob 2–5 fps an einem Telefon gegenüber 5–10 fps auf einem Emulator, weil jeder Frame als vollständiges PNG über die USB-Verbindung geht.
- **CJK-Eingabe braucht ADBKeyboard** (siehe oben); das betrifft Emulatoren und Telefone gleichermaßen.
- **`android_shutdown` kann ein Telefon nicht ausschalten.** adb hat dieses Verb nicht; das Tool sagt es, statt so zu tun als ob.

## Performance

Gemessen auf einem Emulator (Android 14, 1080×2400):

| | |
| --- | --- |
| Persistente screencap-Schleife | ≈ 8 fps |
| Erster Frame von `ensureStreaming` | ~200 ms |
| Umlauf eines `input tap` | ~130 ms |

Möglich macht das der eine persistente Kindprozess: Pro Frame ein `adb` zu starten kostet ~50–100 ms, bevor sich überhaupt ein Pixel bewegt. Rechnen Sie mit ~5–10 fps auf einem Emulator und ~2–5 fps an einem USB-Telefon, je nach Maschine und Bildschirmdichte.

## In DSH installieren

```sh
dsh plugin --profile web add @zseven-w/dsh-android@latest
dsh web
```

Oder fügen Sie es als Abhängigkeit eines bestehenden Profilpakets hinzu:

```sh
pnpm add @zseven-w/dsh-android
```

## Schnellstart

1. **Geräte finden** — „Liste die Android-Geräte auf.“ → `android_devices`.
2. **Stream starten** — „Streame emulator-5554.“ → `android_boot`. Das Panel öffnet sich mit dem Gerät live. (Ein AVD-Name startet zuerst diesen Emulator.)
3. **Auf dem Video tippen** — tippen oder ziehen Sie direkt im Panel, oder lassen Sie den Agenten steuern: „Öffne die Einstellungen und tippe auf Display.“ → `android_interact`, oder `android_ui_tree` + `android_tap_element` für identitätsbasiertes Tippen, oder `android_find_text` + `android_tap_text`, wenn der Baum blind ist.
4. **App bauen und starten** — „Baue und starte /path/to/MyApp.“ → `android_build_run`. Ein vollständiger Gradle-Build dauert Minuten; ist er durch, startet die App und Sie sehen ihr live im Panel zu.
5. **Logs lesen** — „Zeig die letzten zwei Minuten logcat für com.example.app.“ → `android_logs`.

## Fehlerbehebung

- **Alle Tools melden, adb sei nicht verfügbar** — der Fehler benennt die drei Auflösungsstufen. Setzen Sie `ADB=/pfad/zu/adb`, legen Sie `adb` in den `PATH` oder installieren Sie die SDK-Platform-Tools (`sdkmanager "platform-tools"`).
- **Das Gerät ist `unauthorized`** — bestätigen Sie die USB-Debugging-Abfrage auf dem Gerätebildschirm. `android_devices` meldet den Zustand ehrlich, statt das Gerät zu verstecken.
- **`android_boot` findet kein AVD** — der `emulator`-Launcher war nicht auffindbar. Starten Sie den Emulator auf beliebigem Weg; er erscheint in `android_devices`, sobald adb ihn sieht, und `android_boot` übernimmt dann sein Serial.
- **Nicht-ASCII-Text wird abgelehnt** — installieren Sie ADBKeyboard und wählen Sie es als Eingabemethode (siehe Voraussetzungen). Die Ablehnung ist Absicht: `input text` würde die Zeichen stillschweigend verschlucken oder verstümmeln.
- **`android_find_text` meldet, OCR sei nicht verfügbar** — OCR braucht einen macOS-Host (Apples Vision-Framework). Die 17 Tools ohne OCR funktionieren überall.
- **Der Stream stoppt von selbst** — das ist die Leerlaufregel, kein Absturz: Ohne Konsumenten (Panel geschlossen, keine Karten gemountet, keine aktive Route) stoppt der Stream nach 5 Minuten und startet beim nächsten Tool-Aufruf oder beim Öffnen des Panels neu. Eine abgestürzte Schleife startet innerhalb von ~5 Sekunden von selbst neu.
- **Die Drehung wirkt auf dem Launcher falsch** — Launcher und die Einstellungen fixieren sich im Hochformat und ignorieren `user_rotation`. Das ist normales Android-Verhalten, kein Plugin-Fehler; drehen Sie innerhalb einer App, die es erlaubt.

## Entwicklung

```sh
pnpm install
pnpm run build      # Host-tsc + Client-Bundle → lib/
pnpm run typecheck
pnpm test           # alle statischen Suites; kein Gerät nötig
```

Die Smoke-Suites in `scripts/` prüfen das gebaute `lib/`. Alle sind statisch außer `dev-emulator-smoke.mjs`, das ein Gerät braucht und ohne eines SKIP (Exit 0) meldet.

| Skript | Was es abdeckt |
| --- | --- |
| `node scripts/dev-adb-smoke.mjs` | adb-Auflösung (env / PATH / SDK) gegen ein Shim-Binary, das Parsen von `devices -l`, binärsicheres `exec-out`, den PNG-Frame-Splitter samt Resync, das Escaping von input text und den Host-Lebenszyklus (Stream, Steuerung, Leerlauf-Stopp, Dispose) gegen eine gefälschte Toolchain. |
| `node scripts/dev-routes-static-smoke.mjs` | Die signierten Routen gegen einen gefälschten Host: relative Grants, abgelaufene/gefälschte/artfremde Tokens, die Loopback-Absicherung, 405/415/400-Envelopes, codierte Geräteablehnungen, die `/control`-Validierung, die Rotate-Form, die Screenshot-Einschließung und den Live-Multipart-Stream. |
| `node scripts/dev-tools-smoke.mjs` | Die Kern-Tools gegen einen gefälschten Host über die `createAndroidTools`-Naht. |
| `node scripts/dev-uitree-smoke.mjs` | UI-Tree- und Zeilen-Tools: `uiautomator`-XML-Parsing, Selektoren, Tiefenbegrenzung, Zeilen- und Zähler-Heuristiken. |
| `node scripts/dev-logs-smoke.mjs` | `android_logs` snapshot/follow, Filter, Obergrenzen und das Einsammeln von Prozessen. |
| `node scripts/dev-panel-smoke.mjs` | Panel-Komponenten, Größenmodi, Rahmenstile, Dock-/Trigger-/Kapsel-Logik (nur SSR). |
| `node scripts/dev-emulator-smoke.mjs [serial]` | Echtes Gerät: erster Frame, gehaltene Bildrate, Tipp-Umlauf, Dispose. |

## Weitere Fehlerbehebung
### Weißer / leerer Stream auf einem Emulator

Wenn das Panel ein vollständig weißes (oder schwarzes) Bild streamt, während
`android_ui_tree` weiterhin echte UI-Elemente sieht, ist auf Ihrer Maschine das
Framebuffer-Readback über die Host-GPU des Emulators kaputt (ein bekanntes
gfxstream-Problem auf manchen macOS-Hosts — `screencap` selbst liefert leere
Frames, also sind alle Bildschirm-Tools betroffen). Starten Sie den Emulator mit
Software-Rendering neu:

```bash
emulator -avd <name> -gpu swiftshader_indirect
```

oder setzen Sie `hw.gpu.mode=swiftshader_indirect` in der `config.ini` des AVD.
Physische Geräte sind nie betroffen.

## Roadmap

- **Eine Quelle mit höherer Bildrate.** Die `StreamSource`-Naht ist bewusst austauschbar gehalten: Ein Pfad über `scrcpy-server` + WebCodecs H.264 würde den PNG-Stream Frame für Frame ersetzen, ohne Routen, Tools oder Panel anzufassen.
- **Hot Reload für Compose-Previews.** Der iOS-Zwilling tauscht SwiftUI-Previews als dylib heiß aus; Compose hat heute kein äquivalentes Hot-Swap-Primitiv, deshalb bleibt das ein Zukunftspunkt statt einer ausgelieferten, aber wackligen Funktion.

## Ökosystem

- [DSH iOS Simulator](https://github.com/ZSeven-W/dsh-ios) — dieselbe Architektur für den iOS-Simulator und per USB verbundene iPhones
- [DSH Crew](https://github.com/ZSeven-W/dsh-crew) — Arbeit aus Claude Code / Codex an DSH-Agenten delegieren
- [DSH Noema](https://github.com/ZSeven-W/dsh-noema) — Langzeitgedächtnis für DSH
- [DSH OpenPencil](https://github.com/ZSeven-W/dsh-openpencil) — `.op`-Designdokumente in einer Konversation prüfen und bearbeiten

## Danksagungen &amp; Lizenz

- [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools) (`adb`) — zur Laufzeit aufgelöst, niemals mitverteilt: Googles SDK-Lizenz erlaubt kein Bundling.
- [ADBKeyboard](https://github.com/senzhk/ADBKeyBoard) — Senzhk — die optionale IME auf dem Gerät hinter der Nicht-ASCII-Eingabe (Apache-2.0; nicht mitgeliefert).
- Architektur und Routen-Sicherheitshaltung teilt sich dieses Plugin mit [dsh-ios](https://github.com/ZSeven-W/dsh-ios), von wo es portiert wurde.
- Die vollständigen Hinweise finden Sie in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

**Lizenz**: MIT
