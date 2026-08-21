/**
 * Development smoke test for the dsh-android semantic UI layer:
 * uitree.ts / tool-uitree.ts / list-rows.ts / tool-list-rows.ts /
 * ocr-backend.ts / tool-ocr.ts.
 *
 * Run after `pnpm run build` (suites import the COMPILED lib/*.js):
 *   node scripts/dev-uitree-smoke.mjs
 *
 * PURELY STATIC — no device, no adb, no swiftc. The hierarchy fixture below
 * is a REAL `adb exec-out uiautomator dump /dev/tty` capture of the Android 14
 * Settings home screen on emulator-5554 (1080x2400), trailer line included,
 * inlined verbatim so the parser is exercised against the real dialect rather
 * than a hand-written idealization. The tools are driven through their DI seam
 * with a fake host (`makeFakeHost`) that answers the dump from that fixture and
 * records taps.
 *
 * Parts:
 *   A. XML dialect: entity decoding, quote-aware attribute scanning, self
 *      closing tags, bounds/class parsing, empty-attribute omission, the
 *      interesting-state flag rule
 *   B. real fixture: trailer stripping, CRLF, rotation, roots, screen bounds
 *   C. tree shaping: countNodes, filter, max_depth, the 40 KB deepest-level cap
 *   D. resolveTapTarget: exact → contains → chain fold → enabled gate →
 *      off-screen gate → ambiguity candidate list (<= 8)
 *   E. list-rows: row detection on the real fixture, off-screen omission,
 *      counter parsing (中文 + English), the probe-guard and +-1 verification
 *   F. tool level: android_ui_tree / android_tap_element / android_ui_rows /
 *      android_tap_row / the OCR factory shape, plus findJsonViolations on
 *      every emitted result
 *
 * When lib/ cannot be imported (a sibling module is mid-refactor by a parallel
 * agent) the suite prints SKIP and exits 0 — re-run it after the integration
 * build.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TINY_PNG_B64,
  createStepReporter,
  expectThrow,
  findJsonViolations,
  makeExec,
} from './_smoke-harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── the real emulator capture (see the header) ───────────────────────────────
// Split at element boundaries only; `join('')` reconstructs the exact bytes
// adb produced, trailing confirmation line and all.
const FIXTURE_LINES = [
  "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation=\"0\"><node index=\"0\" text=\"\" resource-id=\"\" class=\"android.widget.FrameLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,0][1080,2400]\"><node index=\"0\" text=\"\" resource-id=\"\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,0][1080,2400]\">",
  "<node index=\"0\" text=\"\" resource-id=\"android:id/content\" class=\"android.widget.FrameLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,0][1080,2400]\"><node index=\"0\" text=\"\" resource-id=\"com.android.settings:id/settings_homepage_container\" class=\"android.widget.ScrollView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"true\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,136][1080,2337]\"><node index=\"0\" text=\"\" resource-id=\"com.android.settings:id/app_bar\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,136][1080,778]\"><node index=\"0\" text=\"\" resource-id=\"com.android.settings:id/app_bar_container\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,136][1080,778]\">",
  "<node index=\"0\" text=\"\" resource-id=\"com.android.settings:id/homepage_app_bar_regular_phone_view\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,136][1080,778]\"><node index=\"0\" text=\"\" resource-id=\"com.android.settings:id/account_avatar\" class=\"android.widget.ImageView\" package=\"com.android.settings\" content-desc=\"Profile picture, double tap to open Google Account\" checkable=\"false\" checked=\"false\" clickable=\"true\" enabled=\"true\" focusable=\"true\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[891,283][1017,409]\" /><node index=\"1\" text=\"Settings\" resource-id=\"com.android.settings:id/homepage_title\" class=\"android.widget.TextView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[63,409][408,536]\" /><node index=\"2\" text=\"\" resource-id=\"\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[42,599][1038,736]\">",
  "<node index=\"0\" text=\"\" resource-id=\"com.android.settings:id/search_bar\" class=\"androidx.cardview.widget.CardView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[42,599][1038,736]\"><node index=\"0\" text=\"\" resource-id=\"com.android.settings:id/search_action_bar\" class=\"android.view.ViewGroup\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"true\" enabled=\"true\" focusable=\"true\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[42,599][1038,736]\"><node index=\"0\" text=\"\" resource-id=\"\" class=\"android.widget.ImageButton\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"true\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[53,599][200,736]\" /><node index=\"1\" text=\"Search settings\" resource-id=\"com.android.settings:id/search_action_bar_title\" class=\"android.widget.TextView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[200,632][553,703]\" />",
  "</node></node></node></node>",
  "</node></node><node index=\"1\" text=\"\" resource-id=\"com.android.settings:id/main_content_scrollable_container\" class=\"android.widget.ScrollView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"true\" focused=\"false\" scrollable=\"true\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,778][1080,2337]\"><node index=\"0\" text=\"\" resource-id=\"com.android.settings:id/homepage_container\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"true\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,778][1080,2337]\">",
  "<node index=\"1\" text=\"\" resource-id=\"com.android.settings:id/main_content\" class=\"android.widget.FrameLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,778][1080,2337]\"><node index=\"0\" text=\"\" resource-id=\"com.android.settings:id/container_material\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,778][1080,2337]\"><node index=\"0\" text=\"\" resource-id=\"android:id/list_container\" class=\"android.widget.FrameLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,778][1080,2337]\"><node index=\"0\" text=\"\" resource-id=\"com.android.settings:id/recycler_view\" class=\"androidx.recyclerview.widget.RecyclerView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"true\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,778][1080,2337]\">",
  "<node index=\"0\" text=\"\" resource-id=\"\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"true\" enabled=\"true\" focusable=\"true\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,778][1080,1009]\"><node index=\"0\" text=\"\" resource-id=\"com.android.settings:id/icon_frame\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,851][147,936]\"><node index=\"0\" text=\"\" resource-id=\"android:id/icon\" class=\"android.widget.ImageView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[84,862][147,925]\" /></node>",
  "<node index=\"1\" text=\"\" resource-id=\"com.android.settings:id/text_frame\" class=\"android.widget.RelativeLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[147,790][1080,996]\"><node index=\"0\" text=\"Network &amp; internet\" resource-id=\"android:id/title\" class=\"android.widget.TextView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[189,832][625,903]\" /><node index=\"1\" text=\"Mobile, Wi\u2011Fi, hotspot\" resource-id=\"android:id/summary\" class=\"android.widget.TextView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[189,903][540,954]\" /></node>",
  "</node><node index=\"1\" text=\"\" resource-id=\"\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"true\" enabled=\"true\" focusable=\"true\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,1009][1080,1240]\"><node index=\"0\" text=\"\" resource-id=\"com.android.settings:id/icon_frame\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,1082][147,1167]\"><node index=\"0\" text=\"\" resource-id=\"android:id/icon\" class=\"android.widget.ImageView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[84,1093][147,1156]\" />",
  "</node><node index=\"1\" text=\"\" resource-id=\"com.android.settings:id/text_frame\" class=\"android.widget.RelativeLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[147,1021][1080,1227]\"><node index=\"0\" text=\"Connected devices\" resource-id=\"android:id/title\" class=\"android.widget.TextView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[189,1063][636,1134]\" /><node index=\"1\" text=\"Bluetooth, pairing\" resource-id=\"android:id/summary\" class=\"android.widget.TextView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[189,1134][476,1185]\" />",
  "</node></node><node index=\"2\" text=\"\" resource-id=\"\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"true\" enabled=\"true\" focusable=\"true\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,1240][1080,1471]\"><node index=\"0\" text=\"\" resource-id=\"com.android.settings:id/icon_frame\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,1313][147,1398]\">",
  "<node index=\"0\" text=\"\" resource-id=\"android:id/icon\" class=\"android.widget.ImageView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[84,1324][147,1387]\" /></node><node index=\"1\" text=\"\" resource-id=\"com.android.settings:id/text_frame\" class=\"android.widget.RelativeLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[147,1252][1080,1458]\"><node index=\"0\" text=\"Apps\" resource-id=\"android:id/title\" class=\"android.widget.TextView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[189,1294][311,1365]\" />",
  "<node index=\"1\" text=\"Assistant, recent apps, default apps\" resource-id=\"android:id/summary\" class=\"android.widget.TextView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[189,1365][774,1416]\" /></node></node><node index=\"3\" text=\"\" resource-id=\"\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"true\" enabled=\"true\" focusable=\"true\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,1471][1080,1702]\">",
  "<node index=\"0\" text=\"\" resource-id=\"com.android.settings:id/icon_frame\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,1544][147,1629]\"><node index=\"0\" text=\"\" resource-id=\"android:id/icon\" class=\"android.widget.ImageView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[84,1555][147,1618]\" /></node><node index=\"1\" text=\"\" resource-id=\"com.android.settings:id/text_frame\" class=\"android.widget.RelativeLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[147,1483][1080,1689]\">",
  "<node index=\"0\" text=\"Notifications\" resource-id=\"android:id/title\" class=\"android.widget.TextView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[189,1525][489,1596]\" /><node index=\"1\" text=\"Notification history, conversations\" resource-id=\"android:id/summary\" class=\"android.widget.TextView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[189,1596][745,1647]\" /></node></node>",
  "<node index=\"4\" text=\"\" resource-id=\"\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"true\" enabled=\"true\" focusable=\"true\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,1702][1080,1933]\"><node index=\"0\" text=\"\" resource-id=\"com.android.settings:id/icon_frame\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,1775][147,1860]\"><node index=\"0\" text=\"\" resource-id=\"android:id/icon\" class=\"android.widget.ImageView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[84,1786][147,1849]\" /></node>",
  "<node index=\"1\" text=\"\" resource-id=\"com.android.settings:id/text_frame\" class=\"android.widget.RelativeLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[147,1714][1080,1920]\"><node index=\"0\" text=\"Battery\" resource-id=\"android:id/title\" class=\"android.widget.TextView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[189,1756][357,1827]\" /><node index=\"1\" text=\"100%\" resource-id=\"android:id/summary\" class=\"android.widget.TextView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[189,1827][279,1878]\" /></node>",
  "</node><node index=\"5\" text=\"\" resource-id=\"\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"true\" enabled=\"true\" focusable=\"true\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,1933][1080,2164]\"><node index=\"0\" text=\"\" resource-id=\"com.android.settings:id/icon_frame\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,2006][147,2091]\"><node index=\"0\" text=\"\" resource-id=\"android:id/icon\" class=\"android.widget.ImageView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[84,2017][147,2080]\" />",
  "</node><node index=\"1\" text=\"\" resource-id=\"com.android.settings:id/text_frame\" class=\"android.widget.RelativeLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[147,1945][1080,2151]\"><node index=\"0\" text=\"Storage\" resource-id=\"android:id/title\" class=\"android.widget.TextView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[189,1987][371,2058]\" /><node index=\"1\" text=\"47% used - 4.27 GB free\" resource-id=\"android:id/summary\" class=\"android.widget.TextView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[189,2058][580,2109]\" />",
  "</node></node><node index=\"6\" text=\"\" resource-id=\"\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"true\" enabled=\"true\" focusable=\"true\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,2164][1080,2337]\"><node index=\"0\" text=\"\" resource-id=\"com.android.settings:id/icon_frame\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,2237][147,2322]\">",
  "<node index=\"0\" text=\"\" resource-id=\"android:id/icon\" class=\"android.widget.ImageView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[84,2248][147,2311]\" /></node><node index=\"1\" text=\"\" resource-id=\"com.android.settings:id/text_frame\" class=\"android.widget.RelativeLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[147,2176][1080,2337]\"><node index=\"0\" text=\"Sound &amp; vibration\" resource-id=\"android:id/title\" class=\"android.widget.TextView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[189,2218][601,2289]\" />",
  "<node index=\"1\" text=\"Volume, haptics, Do Not Disturb\" resource-id=\"android:id/summary\" class=\"android.widget.TextView\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[189,2289][707,2337]\" /></node></node><node index=\"7\" text=\"\" resource-id=\"\" class=\"android.widget.LinearLayout\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"true\" enabled=\"true\" focusable=\"true\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,2395][1080,2337]\" />",
  "</node></node></node></node>",
  "</node></node></node></node>",
  "</node><node index=\"1\" text=\"\" resource-id=\"android:id/statusBarBackground\" class=\"android.view.View\" package=\"com.android.settings\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[0,0][1080,136]\" /></node></hierarchy>UI hierchary dumped to: /dev/tty\n",
]
const FIXTURE = FIXTURE_LINES.join('')

/** A synthetic hierarchy for the gates the real Settings screen cannot show. */
const SYNTHETIC = [
  '<?xml version=\'1.0\' encoding=\'UTF-8\' standalone=\'yes\' ?>',
  '<hierarchy rotation="0">',
  '<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="demo.app"',
  ' content-desc="" checkable="false" checked="false" clickable="false" enabled="true"',
  ' focusable="false" focused="false" scrollable="false" long-clickable="false"',
  ' password="false" selected="false" bounds="[0,0][1000,2000]">',
  // A disabled control: the tap gate must refuse it.
  '<node index="0" text="Submit" resource-id="demo.app:id/submit" class="android.widget.Button"',
  ' package="demo.app" content-desc="" checkable="false" checked="false" clickable="false"',
  ' enabled="false" focusable="true" focused="false" scrollable="false" long-clickable="false"',
  ' password="false" selected="false" bounds="[100,100][300,200]" />',
  // Entirely below the screen: the off-screen gate must refuse it.
  '<node index="1" text="Recycled" resource-id="demo.app:id/recycled" class="android.widget.TextView"',
  ' package="demo.app" content-desc="" checkable="false" checked="false" clickable="false"',
  ' enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false"',
  ' password="false" selected="false" bounds="[0,2100][1000,2200]" />',
  // Escaped entities plus a RAW ">" inside a quoted value (quote-aware scan).
  '<node index="2" text="A &amp; B &gt; C &#65;" resource-id="" class="android.widget.TextView"',
  ' package="demo.app" content-desc="tag &gt; sub" checkable="false" checked="false"',
  ' clickable="false" enabled="true" focusable="false" focused="false" scrollable="false"',
  ' long-clickable="false" password="false" selected="false" bounds="[0,300][500,400]" />',
  // Icon-only control: content-desc is the only label, and it is clickable.
  '<node index="3" text="" resource-id="" class="android.widget.ImageView" package="demo.app"',
  ' content-desc="More options > overflow" checkable="false" checked="false" clickable="true"',
  ' enabled="true" focusable="true" focused="true" scrollable="false" long-clickable="false"',
  ' password="false" selected="false" bounds="[900,0][1000,100]" />',
  // A clickable row wrapping a TextView that mirrors its content-desc: the
  // chain must fold onto the OUTER clickable container.
  '<node index="4" text="" resource-id="demo.app:id/row" class="android.widget.LinearLayout"',
  ' package="demo.app" content-desc="Open profile" checkable="false" checked="false"',
  ' clickable="true" enabled="true" focusable="true" focused="false" scrollable="false"',
  ' long-clickable="false" password="false" selected="false" bounds="[0,500][1000,700]">',
  '<node index="0" text="Open profile" resource-id="" class="android.widget.TextView"',
  ' package="demo.app" content-desc="" checkable="false" checked="false" clickable="false"',
  ' enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false"',
  ' password="false" selected="false" bounds="[40,540][600,660]" />',
  '</node>',
  '</node></hierarchy>',
].join('')

/** A three-item feed whose rows carry counters, for the row heuristics. */
function feedFixture({ offscreenRows = 0 } = {}) {
  const row = (index, label, top) => [
    `<node index="${index}" text="" resource-id="feed:id/item" class="android.widget.LinearLayout"`,
    ' package="feed" content-desc="" checkable="false" checked="false" clickable="true"',
    ' enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false"',
    ` password="false" selected="false" bounds="[0,${top}][1080,${top + 300}]">`,
    `<node index="0" text="${label}" resource-id="feed:id/summary" class="android.widget.TextView"`,
    ' package="feed" content-desc="" checkable="false" checked="false" clickable="false"',
    ' enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false"',
    ` password="false" selected="false" bounds="[40,${top + 20}][1040,${top + 120}]" />`,
    '</node>',
  ].join('')
  const rows = [
    row(0, '第一条动态 57 回复。18 喜欢。592 次查看', 400),
    row(1, '第二条动态 12 回复。3 喜欢。88 次查看', 700),
    row(2, 'Third post 57 replies 18 likes 592 views', 1000),
  ]
  for (let extra = 0; extra < offscreenRows; extra += 1) {
    rows.push(row(3 + extra, `Recycled ${extra} 1 回复`, 2600 + extra * 300))
  }
  return [
    '<?xml version=\'1.0\' encoding=\'UTF-8\' standalone=\'yes\' ?>',
    '<hierarchy rotation="0">',
    '<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="feed"',
    ' content-desc="" checkable="false" checked="false" clickable="false" enabled="true"',
    ' focusable="false" focused="false" scrollable="false" long-clickable="false"',
    ' password="false" selected="false" bounds="[0,0][1080,2400]">',
    '<node index="0" text="" resource-id="feed:id/list" class="androidx.recyclerview.widget.RecyclerView"',
    ' package="feed" content-desc="" checkable="false" checked="false" clickable="false"',
    ' enabled="true" focusable="false" focused="false" scrollable="true" long-clickable="false"',
    ' password="false" selected="false" bounds="[0,400][1080,2400]">',
    ...rows,
    '</node></node></hierarchy>',
  ].join('')
}

const { step, finish } = createStepReporter()

let lib
try {
  const [uitree, listRows, toolUitree, toolRows, toolOcr, ocrBackend] = await Promise.all([
    import(join(root, 'lib', 'uitree.js')),
    import(join(root, 'lib', 'list-rows.js')),
    import(join(root, 'lib', 'tool-uitree.js')),
    import(join(root, 'lib', 'tool-list-rows.js')),
    import(join(root, 'lib', 'tool-ocr.js')),
    import(join(root, 'lib', 'ocr-backend.js')),
  ])
  lib = { uitree, listRows, toolUitree, toolRows, toolOcr, ocrBackend }
} catch (error) {
  step('import lib/*.js', 'SKIP', `build not available yet: ${error instanceof Error ? error.message : String(error)}`)
  console.log('\nSKIPPED — run `pnpm run build` (or re-run after integration) and try again.')
  process.exitCode = 0
}

if (lib !== undefined) {
  const {
    boundsCenter,
    buildCompactTree,
    capTreeToBytes,
    classTail,
    countNodes,
    decodeXmlEntities,
    extractHierarchyXml,
    hasLabeledNode,
    isOffscreenBounds,
    parseBounds,
    parseUiTree,
    parseXmlElements,
    resolveTapTarget,
    screenBoundsOf,
  } = lib.uitree
  const {
    detectListRows,
    normalizeCountKey,
    parseCountsFromLabel,
    planRowTap,
    requireCountKey,
    rowCountFor,
    sanitizeCountDelta,
    verifyCountChange,
  } = lib.listRows
  const { createAndroidUiTools, pollForText } = lib.toolUitree
  const { createAndroidRowTools } = lib.toolRows
  const { createAndroidOcrTools, resolveOcrTextTarget, sanitizeMinConfidence } = lib.toolOcr
  const { OCR_INSTALL_HINT, filterOcrItems, parseOcrOutput, pixelRectToNormalizedCenter, resolveOcrBinary } = lib.ocrBackend

  const scratch = mkdtempSync(join(tmpdir(), 'dsh-android-uitree-smoke-'))

  // ── A. XML dialect ─────────────────────────────────────────────────────────
  step(
    'decodeXmlEntities handles the five names plus numeric references',
    decodeXmlEntities('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#65;&#x42; &unknown;')
      === 'a & b <c> "d" \'e\' AB &unknown;',
    decodeXmlEntities('&amp;&#x42;'),
  )
  {
    const elements = parseXmlElements('<?xml version=\'1.0\'?><!-- c --><a x="1&gt;2" y=\'z\'><b/><b k="v"></b></a>')
    const a = elements[0]
    const ok = elements.length === 1
      && a.name === 'a'
      && a.attributes.x === '1>2'
      && a.attributes.y === 'z'
      && a.children.length === 2
      && a.children[0].name === 'b'
      && a.children[1].attributes.k === 'v'
    step('parseXmlElements: prolog/comment skipped, self-closing + nesting', ok, `attrs=${JSON.stringify(a?.attributes)}`)
  }
  {
    const parsed = parseUiTree(SYNTHETIC)
    const rootNode = parsed.roots[0]
    const [submit, recycled, entities, overflow, rowNode] = rootNode.children
    const checks = [
      ['rotation', parsed.rotation === 0],
      ['one root', parsed.roots.length === 1],
      ['class tail', rootNode.type === 'FrameLayout' && submit.type === 'Button'],
      ['empty text/resource-id/content-desc omitted', rootNode.text === undefined && rootNode.resourceId === undefined && rootNode.contentDesc === undefined],
      ['enabled emitted only when false', submit.enabled === false && recycled.enabled === undefined && rootNode.enabled === undefined],
      ['focused/clickable emitted only when true', overflow.clickable === true && overflow.focused === true && submit.clickable === undefined && submit.focused === undefined],
      ['scrollable absent when false', rootNode.scrollable === undefined],
      ['entities decoded in text', entities.text === 'A & B > C A'],
      ['raw ">" inside a quoted value survives', overflow.contentDesc === 'More options > overflow'],
      ['escaped ">" in content-desc', entities.contentDesc === 'tag > sub'],
      ['bounds parsed to origin+size', submit.bounds.x === 100 && submit.bounds.y === 100 && submit.bounds.w === 200 && submit.bounds.h === 100],
      ['nested child parsed', rowNode.children.length === 1 && rowNode.children[0].text === 'Open profile'],
    ]
    for (const [name, ok] of checks) step(`synthetic: ${name}`, ok)
  }
  step('parseBounds rejects garbage', parseBounds('[1,2]') === undefined && parseBounds(undefined) === undefined)
  step('classTail falls back for an empty class', classTail('') === 'Node' && classTail('Foo') === 'Foo' && classTail('a.b.C') === 'C')

  // ── B. the real capture ────────────────────────────────────────────────────
  step('fixture carries the uiautomator trailer line', FIXTURE.includes('UI hierchary dumped to'), `${FIXTURE.length} bytes`)
  {
    const xml = extractHierarchyXml(FIXTURE)
    step('extractHierarchyXml strips the trailer', xml.endsWith('</hierarchy>') && !xml.includes('UI hierchary'))
    step('extractHierarchyXml normalizes CRLF from a tty', extractHierarchyXml(FIXTURE.replace(/\n/g, '\r\n')).endsWith('</hierarchy>'))
    step('extractHierarchyXml keeps an empty self-closed hierarchy', extractHierarchyXml('<?xml?><hierarchy rotation="0"/>ok') === '<hierarchy rotation="0"/>')
  }
  expectThrow(
    step,
    'extractHierarchyXml explains a non-dump payload',
    () => extractHierarchyXml('ERROR: could not get idle state.'),
    /did not contain a <hierarchy> document.*could not get idle state/s,
  )

  const fixtureTree = parseUiTree(extractHierarchyXml(FIXTURE))
  const fixtureScreen = screenBoundsOf(fixtureTree.roots)
  step(
    'real capture parses to one root at 1080x2400',
    fixtureTree.roots.length === 1 && fixtureScreen.width === 1080 && fixtureScreen.height === 2400,
    JSON.stringify(fixtureScreen),
  )
  const fixtureNodeCount = fixtureTree.roots.reduce((sum, node) => sum + countNodes(node), 0)
  step('real capture node count is plausible', fixtureNodeCount > 30 && fixtureNodeCount < 500, `${fixtureNodeCount} nodes`)
  step('real capture carries labels', hasLabeledNode(fixtureTree.roots))
  step(
    'real capture exposes settings resource-ids',
    JSON.stringify(fixtureTree.roots).includes('com.android.settings:id/'),
  )

  // ── C. tree shaping ────────────────────────────────────────────────────────
  {
    const all = buildCompactTree(fixtureTree.roots)
    const filtered = buildCompactTree(fixtureTree.roots, undefined, 'battery')
    const missed = buildCompactTree(fixtureTree.roots, undefined, 'zzz-no-such-node')
    const shallow = buildCompactTree(fixtureTree.roots, 1)
    const depthOf = nodes => nodes.reduce((deepest, node) => Math.max(deepest, node.children.length === 0 ? 0 : 1 + depthOf(node.children)), 0)
    step('buildCompactTree returns every node unfiltered', all.count === fixtureNodeCount)
    step('filter keeps matches + ancestors only', filtered.count > 0 && filtered.count < all.count, `${filtered.count}/${all.count}`)
    step('filter miss yields an empty tree', missed.count === 0 && missed.tree.length === 0)
    step('max_depth caps nesting', depthOf(shallow.tree) === 1, `depth=${depthOf(shallow.tree)}`)
    step('filter is case-insensitive over text/id/type', buildCompactTree(fixtureTree.roots, undefined, 'BATTERY').count === filtered.count)
  }
  {
    const big = buildCompactTree(fixtureTree.roots).tree
    const before = Buffer.byteLength(JSON.stringify(big), 'utf8')
    const capped = capTreeToBytes(big, 2000)
    const after = Buffer.byteLength(JSON.stringify(capped.tree), 'utf8')
    step('capTreeToBytes prunes the deepest levels', capped.truncated && after <= 2000 && before > 2000, `${before} → ${after} bytes`)
    const small = capTreeToBytes(buildCompactTree(fixtureTree.roots, 0).tree, 40 * 1024)
    step('capTreeToBytes leaves a small tree untouched', small.truncated === false)
  }
  step('isOffscreenBounds is geometric', isOffscreenBounds({ x: 0, y: 2400, w: 100, h: 100 }, fixtureScreen)
    && !isOffscreenBounds({ x: 0, y: 0, w: 10, h: 10 }, fixtureScreen))
  step('boundsCenter rounds to whole pixels', JSON.stringify(boundsCenter({ x: 0, y: 0, w: 101, h: 51 })) === '{"x":51,"y":26}')

  // ── D. selector resolution ─────────────────────────────────────────────────
  const synthRoots = parseUiTree(SYNTHETIC).roots
  {
    const exact = resolveTapTarget(fixtureTree.roots, { label: 'Battery' })
    step('exact label match wins', exact.matchedBy === 'exact' && exact.node.text === 'Battery', JSON.stringify(exact.node.bounds))
    const contains = resolveTapTarget(fixtureTree.roots, { label: 'onnected devic' })
    step('case-insensitive contains is the fallback', contains.matchedBy === 'contains' && /Connected devices/.test(contains.node.text ?? ''))
    const byId = resolveTapTarget(fixtureTree.roots, { identifier: 'com.android.settings:id/search_action_bar_title' })
    step('identifier matches the resource-id', byId.node.resourceId === 'com.android.settings:id/search_action_bar_title')
  }
  {
    const folded = resolveTapTarget(synthRoots, { label: 'Open profile' })
    step(
      'containment chain folds onto the outer clickable container',
      folded.node.type === 'LinearLayout' && folded.node.clickable === true && folded.node.bounds.h === 200,
      `${folded.node.type} ${JSON.stringify(folded.node.bounds)}`,
    )
    const icon = resolveTapTarget(synthRoots, { label: 'More options' })
    step('label also matches content-desc', icon.node.type === 'ImageView')
  }
  await expectThrow(
    step,
    'no selector is refused with guidance',
    () => resolveTapTarget(synthRoots, {}),
    /requires an element selector.*android_ui_tree/s,
  )
  await expectThrow(
    step,
    'no match names the OCR escape hatch',
    () => resolveTapTarget(synthRoots, { label: 'zzz-nope' }),
    /android_tap_element: no node matches label "zzz-nope".*android_find_text/s,
  )
  await expectThrow(
    step,
    'enabled gate refuses a disabled control',
    () => resolveTapTarget(synthRoots, { label: 'Submit' }),
    /android_tap_element: .*disabled node.*enable it first/s,
  )
  await expectThrow(
    step,
    'off-screen gate refuses a recycled row',
    () => resolveTapTarget(synthRoots, { label: 'Recycled' }),
    /off-screen node.*scroll it into view.*allow_offscreen=true/s,
  )
  step(
    'allow_offscreen bypasses only the off-screen half',
    resolveTapTarget(synthRoots, { label: 'Recycled' }, { allowOffscreen: true }).node.text === 'Recycled',
  )
  await expectThrow(
    step,
    'allow_offscreen still refuses a disabled control',
    () => resolveTapTarget(synthRoots, { label: 'Submit' }, { allowOffscreen: true }),
    /disabled node/,
  )
  {
    let message = ''
    try {
      resolveTapTarget(fixtureTree.roots, { label: 'e' })
    } catch (error) {
      message = error.message
    }
    const listed = (message.match(/^ {2}\d+\) /gm) ?? []).length
    const ok = /nodes match label "e"/.test(message) && listed === 8 && /…and \d+ more/.test(message)
    step('ambiguity lists at most 8 candidates and counts the rest', ok, `${listed} listed`)
    step('candidate lines carry type + bounds', /type=\w+.*bounds=\{x:\d+,y:\d+,w:\d+,h:\d+\}/.test(message))
  }

  // ── E. list rows ───────────────────────────────────────────────────────────
  {
    const detected = detectListRows(fixtureTree.roots, { bounds: fixtureScreen })
    const labels = detected.rows.map(row => row.label ?? '')
    const ok = detected.rows.length === 6
      && detected.repeatedGroups === 1
      && detected.omittedOffscreen === 0
      && labels[0].startsWith('Network & internet')
      && labels[4].startsWith('Battery')
      && detected.rows.every((row, index) => row.index === index)
    step('real Settings capture yields 6 isomorphic rows', ok, labels.map(label => label.slice(0, 22)).join(' | '))
    step(
      'rows are ordered top-to-bottom with pixel frames',
      detected.rows.every((row, index) => index === 0 || row.frame.y > detected.rows[index - 1].frame.y)
        && detected.rows[0].frame.w === 1080,
    )
  }
  {
    const feedRoots = parseUiTree(feedFixture({ offscreenRows: 2 })).roots
    const feedScreen = screenBoundsOf(feedRoots)
    const detected = detectListRows(feedRoots, { bounds: feedScreen })
    step(
      'off-screen (recycled) rows are dropped and counted',
      detected.rows.length === 3 && detected.omittedOffscreen === 2,
      `rows=${detected.rows.length} omitted=${detected.omittedOffscreen}`,
    )
    const first = detected.rows[0]
    step(
      'row label aggregates the subtree text',
      first.label === '第一条动态 57 回复。18 喜欢。592 次查看',
      first.label,
    )
    step(
      'Chinese counters parse out of the aggregated label',
      rowCountFor(first, '回复') === 57 && rowCountFor(first, '喜欢') === 18 && rowCountFor(first, '次查看') === 592,
      JSON.stringify(first.counts),
    )
    const third = detected.rows[2]
    step(
      'English counters parse the same way',
      rowCountFor(third, 'replies') === 57 && rowCountFor(third, 'likes') === 18 && rowCountFor(third, 'views') === 592,
      JSON.stringify(third.counts),
    )
    step('two isomorphic runs are one group', detected.repeatedGroups === 1)

    const plan = planRowTap(detected.rows, 1, 0.9, 0.5, feedScreen)
    step(
      'planRowTap places the tap inside the row frame',
      plan.tap.x === Math.round(detected.rows[1].frame.x + 0.9 * detected.rows[1].frame.w)
        && plan.tap.y === Math.round(detected.rows[1].frame.y + 0.5 * detected.rows[1].frame.h),
      JSON.stringify(plan.tap),
    )
    expectThrow(
      step,
      'planRowTap FAILS an out-of-range index instead of clamping',
      () => planRowTap(detected.rows, 9, 0.5, 0.5, feedScreen),
      /row 9 does not exist.*3 visible row\(s\).*never tap a remembered position/s,
    )
    expectThrow(
      step,
      'planRowTap rejects a fraction outside 0..1',
      () => planRowTap(detected.rows, 0, 1.5, 0.5, feedScreen),
      /x must be a fraction within 0\.\.1/,
    )
    step('requireCountKey returns the before value', requireCountKey(first, '回复') === 57)
    expectThrow(
      step,
      'requireCountKey refuses BEFORE the tap when the key is unknown',
      () => requireCountKey(first, '转发'),
      /cannot verify a "转发" change.*never probed/s,
    )
  }
  {
    const multipliers = parseCountsFromLabel('3.2W 赞 1.5万 收藏 2k views 1亿 播放')
    const value = key => multipliers.find(count => count.key === key)?.value
    step(
      'numeric units multiply (万/亿/k/w)',
      value('赞') === 32000 && value('收藏') === 15000 && value('views') === 2000 && value('播放') === 100000000,
      JSON.stringify(multipliers),
    )
    step('normalizeCountKey collapses whitespace and case', normalizeCountKey('  Next   Views ') === 'next views')
    step('sanitizeCountDelta accepts only ±1', sanitizeCountDelta(1) === 1 && sanitizeCountDelta(-1) === -1)
    expectThrow(step, 'sanitizeCountDelta rejects 2', () => sanitizeCountDelta(2), /must be \+1 or -1/)
  }
  {
    const rowAt = (y, label) => ({ index: 0, type: 'LinearLayout', frame: { x: 0, y, w: 1080, h: 300 }, label, counts: parseCountsFromLabel(label) })
    const before = rowAt(400, '帖子 18 喜欢')
    step('verifyCountChange verifies an exact +1', verifyCountChange(before, rowAt(400, '帖子 19 喜欢'), '喜欢', 1).verified === true)
    const wrong = verifyCountChange(before, rowAt(400, '帖子 25 喜欢'), '喜欢', 1)
    step('a wrong delta is unverified with a reason', wrong.verified === false && wrong.changed === true && /moved by 7/.test(wrong.reason ?? ''), wrong.reason)
    const moved = verifyCountChange(before, rowAt(1400, '帖子 19 喜欢'), '喜欢', 1)
    step('a moved row is not comparable', moved.verified === false && /row moved/.test(moved.reason ?? ''), moved.reason)
    const gone = verifyCountChange(before, rowAt(400, '帖子'), '喜欢', 1)
    step('a vanished key is reported, not guessed', gone.verified === false && /absent from the re-read label/.test(gone.reason ?? ''))
    step('no -0 escapes a count check', findJsonViolations(wrong).length === 0)
  }

  // ── F. tool level (DI fake host) ───────────────────────────────────────────
  const FAKE_DEVICE = {
    serial: 'emulator-5554',
    state: 'device',
    emulator: true,
    model: 'sdk_gphone64_arm64',
    product: 'sdk_gphone64_arm64',
  }

  function makeFakeHost(xml) {
    const taps = []
    const dumps = []
    return {
      taps,
      dumps,
      host: {
        toolchain: {
          async execOut(serial, command) {
            if (command[0] === 'uiautomator') {
              dumps.push(serial)
              // Answer exactly as the device does: XML plus the trailer line.
              return Buffer.from(`${xml}UI hierchary dumped to: /dev/tty\n`, 'utf8')
            }
            throw new Error(`unexpected exec-out: ${command.join(' ')}`)
          },
          async shell() {
            return ''
          },
        },
        async resolveTarget(serial) {
          if (serial !== undefined && serial !== FAKE_DEVICE.serial) throw new Error(`unknown serial ${serial}`)
          return FAKE_DEVICE
        },
        async tap(serial, x, y) {
          taps.push({ serial, x, y })
        },
        async screenshot() {
          return { png: Buffer.from(TINY_PNG_B64, 'base64'), width: 1, height: 1 }
        },
      },
    }
  }

  {
    const fake = makeFakeHost(extractHierarchyXml(FIXTURE))
    const tools = createAndroidUiTools(fake.host, { cacheDir: scratch })
    step(
      'createAndroidUiTools registers the two tool names',
      tools.androidUiTree.name === 'android_ui_tree'
        && tools.androidTapElement.name === 'android_tap_element'
        && tools.androidUiTree.isConcurrencySafe?.({}) === true,
    )
    const tree = await tools.androidUiTree.execute({}, makeExec('android_ui_tree', {}))
    step(
      'android_ui_tree returns {device, screen, nodeCount, tree}',
      tree.device.serial === 'emulator-5554'
        && tree.device.name === 'sdk_gphone64_arm64'
        && tree.device.state === 'device'
        && tree.screen.width === 1080 && tree.screen.height === 2400
        && tree.nodeCount === fixtureNodeCount
        && Array.isArray(tree.tree) && tree.tree.length === 1
        && tree.truncated === undefined,
      `nodeCount=${tree.nodeCount}`,
    )
    step('android_ui_tree result is lossless JSON', findJsonViolations(tree).length === 0, findJsonViolations(tree).join(', '))
    const filtered = await tools.androidUiTree.execute({ filter: 'zzz-nothing' }, makeExec('android_ui_tree', {}))
    step(
      'a filter miss is blamed on the filter, never on the app',
      filtered.nodeCount === 0 && /filter "zzz-nothing" matched nothing/.test(filtered.hint ?? '')
        && !/no accessibility information/.test(filtered.hint ?? ''),
      filtered.hint?.slice(0, 80),
    )

    const tapped = await tools.androidTapElement.execute({ label: 'Battery' }, makeExec('android_tap_element', {}))
    const expectedTap = {
      x: Math.round((tapped.element.bounds.x + tapped.element.bounds.w / 2)) / 1080,
      y: Math.round((tapped.element.bounds.y + tapped.element.bounds.h / 2)) / 2400,
    }
    step(
      'android_tap_element taps the node center as normalized 0..1',
      fake.taps.length === 1
        && fake.taps[0].serial === 'emulator-5554'
        && Math.abs(fake.taps[0].x - expectedTap.x) < 1e-4
        && Math.abs(fake.taps[0].y - expectedTap.y) < 1e-4
        && tapped.action === 'tap-element'
        && tapped.element.text === 'Battery',
      JSON.stringify(fake.taps[0]),
    )
    step(
      'android_tap_element captures the settle screenshot into the store',
      typeof tapped.path === 'string'
        && tapped.path.startsWith(join(scratch, 'screenshots'))
        && /screenshot-emulator-5554-\d+\.png$/.test(tapped.path)
        && tapped.bytes > 0
        && readFileSync(tapped.path).length === tapped.bytes,
      tapped.path,
    )
    step('android_tap_element omits expected when nothing was asserted', tapped.expected === undefined)
    step('android_tap_element result is lossless JSON', findJsonViolations(tapped).length === 0, findJsonViolations(tapped).join(', '))
    const meta = tools.androidTapElement.output?.presentationMeta?.({}, tapped)
      ?? tools.androidTapElement.presentationMeta?.({}, tapped)
    step(
      'presentationMeta is the android-screenshot envelope',
      meta !== undefined && meta.kind === 'android-screenshot'
        && meta.path === tapped.path && meta.screenshotPath === tapped.path
        && meta.device.serial === 'emulator-5554',
      JSON.stringify(meta ?? null).slice(0, 120),
    )
    // A second capture must never reuse the first path (live signed URLs).
    const again = await tools.androidTapElement.execute({ label: 'Storage' }, makeExec('android_tap_element', {}))
    step('screenshot paths never collide', again.path !== tapped.path, again.path)
    await expectThrow(
      step,
      'expect_text and expect_gone are mutually exclusive',
      () => tools.androidTapElement.execute({ label: 'Battery', expect_text: 'a', expect_gone: 'b' }, makeExec('android_tap_element', {})),
      /expect_text OR expect_gone, not both/,
    )
  }

  {
    const fake = makeFakeHost(feedFixture({ offscreenRows: 2 }))
    const tools = createAndroidRowTools(fake.host, { cacheDir: scratch })
    step(
      'createAndroidRowTools registers the two tool names',
      tools.androidUiRows.name === 'android_ui_rows' && tools.androidTapRow.name === 'android_tap_row',
    )
    const rows = await tools.androidUiRows.execute({}, makeExec('android_ui_rows', {}))
    step(
      'android_ui_rows returns {device, rowCount, omittedOffscreen, rows}',
      rows.rowCount === 3
        && rows.omittedOffscreen === 2
        && rows.repeatedGroups === 1
        && rows.rows[0].counts.some(count => count.key === '回复' && count.value === 57)
        && /keys round-trip/.test(rows.note ?? ''),
      `rowCount=${rows.rowCount} omitted=${rows.omittedOffscreen}`,
    )
    step('android_ui_rows result is lossless JSON', findJsonViolations(rows).length === 0, findJsonViolations(rows).join(', '))

    const tapped = await tools.androidTapRow.execute({ row: 1, x: 0.9 }, makeExec('android_tap_row', {}))
    step(
      'android_tap_row taps inside the row at the requested fraction',
      tapped.action === 'tap-row'
        && tapped.row.index === 1
        && tapped.inRow.x === 0.9 && tapped.inRow.y === 0.5
        && tapped.center.x === Math.round(rows.rows[1].frame.x + 0.9 * rows.rows[1].frame.w)
        && Math.abs(fake.taps.at(-1).x - tapped.center.x / 1080) < 1e-4
        && /No expect_count was given/.test(tapped.note ?? ''),
      `${JSON.stringify(tapped.center)} → ${JSON.stringify(fake.taps.at(-1))}`,
    )
    step('android_tap_row result is lossless JSON', findJsonViolations(tapped).length === 0, findJsonViolations(tapped).join(', '))
    const tapsBefore = fake.taps.length
    await expectThrow(
      step,
      'android_tap_row FAILS an out-of-range index (never clamps)',
      () => tools.androidTapRow.execute({ row: 7 }, makeExec('android_tap_row', {})),
      /row 7 does not exist.*Re-run android_ui_rows/s,
    )
    await expectThrow(
      step,
      'android_tap_row refuses an unknown expect_count key BEFORE tapping',
      () => tools.androidTapRow.execute({ row: 0, expect_count: { key: '转发', delta: 1 } }, makeExec('android_tap_row', {})),
      /cannot verify a "转发" change.*never probed/s,
    )
    step('no tap happened on either refusal', fake.taps.length === tapsBefore, `${fake.taps.length} taps`)
    await expectThrow(
      step,
      'android_tap_row rejects a delta other than ±1',
      () => tools.androidTapRow.execute({ row: 0, expect_count: { key: '回复', delta: 3 } }, makeExec('android_tap_row', {})),
      /delta must be \+1 or -1/,
    )
    // expect_count verification: the fake re-reads the SAME fixture, so the
    // counter cannot have moved — the check must report that honestly.
    const verified = await tools.androidTapRow.execute({ row: 0, expect_count: { key: '回复', delta: 1 } }, makeExec('android_tap_row', {}))
    step(
      'expect_count reports unverified-with-reason when the counter did not move',
      verified.countCheck?.verified === false
        && verified.countCheck?.before === 57
        && verified.countCheck?.after === 57
        && /moved by 0/.test(verified.countCheck?.reason ?? ''),
      verified.countCheck?.reason,
    )
    step('android_tap_row verified result is lossless JSON', findJsonViolations(verified).length === 0)
  }

  {
    const fake = makeFakeHost(SYNTHETIC)
    const rows = await createAndroidRowTools(fake.host, { cacheDir: scratch })
      .androidUiRows.execute({}, makeExec('android_ui_rows', {}))
    step(
      'no rows on a non-list screen names the right cause',
      rows.rowCount === 0
        && /not a scrollable list/.test(rows.hint ?? '')
        && !/no accessibility information/.test(rows.hint ?? ''),
      rows.hint?.slice(0, 90),
    )
  }

  // ── F2. OCR layer (static: factory shape + pure helpers) ───────────────────
  {
    const fake = makeFakeHost(FIXTURE)
    const tools = createAndroidOcrTools(fake.host, { cacheDir: scratch })
    step(
      'createAndroidOcrTools registers the three tool names',
      tools.androidFindText.name === 'android_find_text'
        && tools.androidTapText.name === 'android_tap_text'
        && tools.androidWaitFor.name === 'android_wait_for'
        // isConcurrencySafe runs behind argument validation, so android_wait_for
        // (whose `text` is required) only answers true for valid arguments.
        && tools.androidFindText.isConcurrencySafe?.({}) === true
        && tools.androidWaitFor.isConcurrencySafe?.({ text: 'Done' }) === true
        && tools.androidTapText.isConcurrencySafe === undefined,
    )
    await expectThrow(
      step,
      'android_wait_for requires a non-empty text',
      () => tools.androidWaitFor.execute({ text: '   ' }, makeExec('android_wait_for', {})),
      /android_wait_for requires a non-empty text/,
    )
    await expectThrow(
      step,
      'android_tap_text requires a non-empty query',
      () => tools.androidTapText.execute({ query: '' }, makeExec('android_tap_text', {})),
      /android_tap_text requires a non-empty query/,
    )
  }
  {
    const payload = JSON.stringify({
      items: [
        { text: ' Battery ', confidence: 0.91, x: 189, y: 1756, w: 168, h: 71 },
        { text: 'Battery', confidence: 0.91, x: 189, y: 1756, w: 168, h: 71 },
        { text: '电池', confidence: 0.44, x: 189, y: 1900, w: 120, h: 60 },
        { text: 'bad', confidence: 2, x: 0, y: 0, w: 10, h: 10 },
        { text: '', confidence: 0.9, x: 0, y: 0, w: 10, h: 10 },
      ],
    })
    const items = parseOcrOutput(payload)
    step(
      'parseOcrOutput trims, dedupes, drops invalid items and sorts by confidence',
      items.length === 2 && items[0].text === 'Battery' && items[0].confidence === 0.91 && items[1].text === '电池',
      JSON.stringify(items),
    )
    step('filterOcrItems applies query + confidence floor', filterOcrItems(items, 'batt', 0.5).length === 1
      && filterOcrItems(items, undefined, 0.5).length === 1
      && filterOcrItems(items).length === 2)
    expectThrow(step, 'parseOcrOutput rejects non-JSON', () => parseOcrOutput('nope'), /non-JSON output/)
    expectThrow(step, 'parseOcrOutput rejects a missing items array', () => parseOcrOutput('{}'), /missing items array/)
    const center = pixelRectToNormalizedCenter({ x: 189, y: 1756, w: 168, h: 71 }, { width: 1080, height: 2400 })
    step(
      'pixel box → normalized center uses the screenshot size only',
      Math.abs(center.x - 273 / 1080) < 1e-9 && Math.abs(center.y - 1791.5 / 2400) < 1e-9,
      JSON.stringify(center),
    )
    step('sanitizeMinConfidence defaults to 0.3', sanitizeMinConfidence(undefined) === 0.3 && sanitizeMinConfidence(0.7) === 0.7)
    expectThrow(step, 'sanitizeMinConfidence rejects out-of-range', () => sanitizeMinConfidence(1.5), /within 0\.\.1/)

    const resolved = resolveOcrTextTarget(filterOcrItems(items, 'Battery', 0.3), 'Battery', items, 0.3)
    step('resolveOcrTextTarget matches exactly first', resolved.matchedBy === 'exact' && resolved.item.text === 'Battery')
    expectThrow(
      step,
      'resolveOcrTextTarget names a confidence near-miss',
      () => resolveOcrTextTarget(filterOcrItems(items, '电池', 0.6), '电池', items, 0.6),
      /"电池" IS on the current screen.*below min_confidence.*CJK labels commonly read/s,
    )
    expectThrow(
      step,
      'resolveOcrTextTarget explains a real miss',
      () => resolveOcrTextTarget([], 'nope', [], 0.3),
      /no recognized text matches "nope".*android_find_text/s,
    )
    const many = Array.from({ length: 11 }, (_, index) => ({ text: `Item ${index}`, confidence: 0.9, rect: { x: index, y: index, w: 10, h: 10 } }))
    let ambiguous = ''
    try {
      resolveOcrTextTarget(many, 'Item', many, 0)
    } catch (error) {
      ambiguous = error.message
    }
    step(
      'resolveOcrTextTarget lists at most 8 OCR candidates',
      /11 OCR matches for "Item"/.test(ambiguous) && (ambiguous.match(/^ {2}\d+\) /gm) ?? []).length === 8 && /…and 3 more/.test(ambiguous),
    )
  }
  {
    // pollForText through its injected read seam: no device, no OCR binary.
    const appear = []
    const outcome = await pollForText(
      async () => {
        appear.push(1)
        return appear.length >= 2 ? [{ text: 'Done', confidence: 0.9, rect: { x: 0, y: 0, w: 1, h: 1 } }] : []
      },
      'Done', 'appear', 3000, 1, 0,
    )
    step('pollForText resolves once the text appears', outcome.matched === true && outcome.item?.text === 'Done' && appear.length === 2)
    const timedOut = await pollForText(async () => [], 'Never', 'appear', 0, 1, 0)
    step('pollForText reports a timeout as matched:false, never a throw', timedOut.matched === false && timedOut.item === undefined)
    const gone = await pollForText(async () => [], 'Spinner', 'disappear', 3000, 1, 0)
    step('pollForText handles the disappear mode', gone.matched === true)
  }
  {
    const binary = resolveOcrBinary()
    const ok = process.platform === 'darwin'
      ? typeof binary.available === 'boolean' && binary.installHint === OCR_INSTALL_HINT
      : binary.available === false && /macOS host/.test(binary.reason ?? '') && /android_ui_tree/.test(binary.reason ?? '')
    step(`resolveOcrBinary degrades explicitly on ${process.platform}`, ok, binary.reason?.slice(0, 90) ?? binary.source)
    step('OCR install hint names the android tools', /android_find_text \/ android_tap_text \/ android_wait_for/.test(OCR_INSTALL_HINT))
  }

  rmSync(scratch, { recursive: true, force: true })
  finish()
}
