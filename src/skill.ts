/**
 * The plugin's bundled playbook, contributed through `ctx.skills.register()`.
 *
 * Why a skill and not longer tool descriptions: a description answers "what
 * does this argument mean", one tool at a time. What agents re-derive every
 * session is the WORKFLOW between the tools — which observer to reach for,
 * how to confirm an action landed, what a device actually refuses to tell you.
 * The dsh-ios twin was written after a session log measured 25 observation
 * calls for 6 actions, plus raw `curl` against WebDriverAgent and an ad-hoc
 * pixel-counting script to check whether a like had registered. Android has
 * the same failure modes and two of its own: package names that cannot be
 * guessed BECAUSE there is no label to guess from, and a shell user that is
 * denied most of what a debugger would want.
 *
 * Registration is DEFENSIVE: a profile without the skill service still loads
 * the plugin, it just does not advertise the playbook.
 * @module @zseven-w/dsh-android/skill
 */

import type { Context } from '@deepseek-ai/cordis'

/** Kebab-case skill id, addressable as `/android-ui-automation`. */
export const ANDROID_SKILL_NAME = 'android-ui-automation'

export const ANDROID_SKILL_DESCRIPTION =
  'Drive an Android emulator or a USB-connected phone through adb: read the screen, tap, scroll, type, '
  + 'and confirm that an action landed. Read this before the first android_* call of a UI task.'

export const ANDROID_SKILL_WHEN_TO_USE =
  'Any task that operates an Android app through the android_* tools — opening apps, tapping controls, '
  + 'filling fields, scrolling a list, reading logs, or verifying what is on screen, on an emulator or a '
  + 'real device.'

/**
 * The playbook body. Model-facing, so it is English like the tool
 * descriptions, and it states costs in milliseconds because the whole point is
 * helping the model choose the cheap path first. Every number was measured on
 * this plugin's own tools against an Android 14 emulator (1080×2400).
 */
export const ANDROID_SKILL_CONTENT = `# Driving Android with dsh-android

The loop is **observe once → act with an assertion → observe again only if the assertion could not settle it**. Everything here goes through \`adb\`; there is no second backend, and an emulator and a phone take exactly the same tools with the same arguments.

## Seeing the screen (image-capable models)

On a model that declares image input, every capture-producing tool
(android_screenshot, android_interact, android_tap_element, android_tap_text,
android_tap_row) returns the screenshot ITSELF as an image alongside its JSON
summary — look at it directly instead of OCR-transcribing the screen. The OCR
trio (android_find_text / android_tap_text / android_wait_for) remains the
right tool when you need PIXEL-PRECISE coordinates for a text target, and the
only reader on text-only routes or non-macOS hosts.

## Reading the screen

| Tool | Cost | Use it for |
| --- | --- | --- |
| \`android_ui_tree\` | ~0.6–1.5 s | hierarchy, resource-ids, text, enabled state — the default observer |
| \`android_find_text\` | ~1.0 s | "what text is on screen, and where", when the tree is unlabeled |
| \`android_screenshot\` | ~0.3 s | showing the USER a picture |

- Start with \`android_ui_tree\`: on Android the accessibility tree carries \`resource-id\` (e.g. \`com.android.settings:id/search_bar\`), which is the most stable handle a control can have — far better than its text, which changes with the device language.
- The screenshot path is for humans. Do NOT feed it to an image-reading tool: on a text-only model that call always fails, and pixel-diffing is never how you check whether a tap worked (see *Confirming*).
- \`uiautomator\` dumps a snapshot of the CURRENT frame. If an animation is still running the tree can be a half-finished layout; when a read looks wrong, re-read once rather than reasoning about the wrong frame.
- A shallow or empty tree is NEVER evidence that an app lacks accessibility support. Attribute an unlabeled read to ONE of three causes — (a) the depth/filter cut it: re-read wider; (b) a WebView or a Compose surface that publishes little: \`android_find_text\` (OCR) is the fallback; (c) a DEEP, unfiltered read with no labels — only then may "little accessibility information" be reported. Never jump from a shallow read to "OCR the screen".

## Acting

- Prefer \`android_tap_element\` (resource-id / text / content-desc) or \`android_tap_text\` (OCR). Raw coordinates through \`android_interact action=tap\` are the last resort — they break on the next layout change.
- Coordinates are **fractions of the live frame, 0..1**. The frame follows the display rotation (a landscape app streams 2400×1080), and \`input tap\` uses the same space, so **no reverse rotation mapping is ever needed**. Do not compute pixels from \`wm size\`: it reports the physical portrait size and never rotates.
- Scrolling is \`android_interact action=scroll\` with \`direction\`. Never hand-build a swipe: the tool clamps the whole path into 8%..92% of the travelling axis, keeping it out of Android's gesture-navigation strips (bottom bar, both side edges) which otherwise swallow the gesture before the app sees it. \`direction\` names the CONTENT: \`down\` reveals content further down the page (the finger moves up).
- Navigation is \`android_interact action=button\`: \`back\`, \`home\`, \`recents\`, plus \`power\`, \`volume_up\`, \`volume_down\`, \`menu\`, \`enter\`, \`delete\`, or any raw \`KEYCODE_*\`. **\`back\` is a first-class verb on Android** — use it instead of hunting for an on-screen back arrow.
- Typing is ASCII-only through \`adb shell input text\`. Non-ASCII (Chinese, emoji) needs the ADBKeyboard IME installed AND selected on the device; without it the tool REFUSES rather than typing the wrong characters. Do not retry — install the IME or type through the app's own UI.

## Never guess a package name

- \`android_launch_app\` opens an installed app — no shell needed. Pass \`packageName\`, or \`name\` (a case-insensitive fragment of the package name).
- **Android exposes no app label over adb.** An app's \`android:label\` lives in its compiled resources, which need \`aapt2\` from the SDK, not the device — so \`android_list_apps\` matches PACKAGE NAMES only. A Chinese/Japanese label read off the screen will never match a listing. Match a package fragment ("settings", "chrome"), or open the app by tapping its icon (\`android_find_text\` + \`android_tap_text\`).
- A package name that looks plausible — an app's former name, or the pattern a sibling app uses — is routinely NOT the installed one, and a wrong guess is indistinguishable from "not installed" until you list. Run \`android_list_apps\` first; \`android_app_info\` is the cheap yes/no for one specific name.
- Stable AOSP/GMS packages: Settings \`com.android.settings\`, Chrome \`com.android.chrome\`, Clock \`com.google.android.deskclock\`, Calendar \`com.google.android.calendar\`, Files \`com.google.android.documentsui\`, Play Store \`com.android.vending\`, Camera \`com.android.camera2\`.

## Boundaries

- Everything the task needs is **on the device**. If an app seems to be missing, list what is installed (\`android_list_apps\`) — never go looking for it in the user's source tree, in a Gradle build directory, or in unrelated repositories. That direction is always wrong: the app is an APK on the device, not a project on this machine.
- An empty or failed listing is **not** proof an app is absent. Every listing tool THROWS with the reason when it fails, so \`count: 0\` on a successful call is a fact about the device. Read the error before concluding anything.

## Confirming an action landed

- Pass \`expect_text\` (or \`expect_gone\`) to the tap tools: the tap and its verification become one round trip, and the result carries \`expected.matched\`.
- For list/feed actions the ONLY reliable confirmation is the counter change: \`android_tap_row\` with \`expect_count={key,delta}\` (±1) re-reads the row label and reports \`countCheck.verified\`. If it is not verified, say so — never treat an unverified tap as done, and never re-tap blindly to "see if it worked".
- Waiting for something slow (a load, an animation, a network round trip) is \`android_wait_for\` — one call that polls internally, instead of a find_text loop.
- Never compare screenshots or count pixels to decide whether something happened. Read the text back.

## Real devices

- **Every tap on a real phone has real consequences** — posts, likes, purchases, messages, shares. NEVER tap an unidentified control to find out what it does. If a control cannot be identified (no resource-id after a deep tree, no distinguishing text), STOP and report what you see and ask how to proceed. Do not guess coordinates on someone's live account.
- Icon-only controls carry no OCR text by definition: the tree's \`content-desc\` is the only reliable way to find them — a bare tree means "look deeper", never "start guessing".
- A phone must be UNLOCKED for anything to be visible; a locked screen is what the stream will faithfully show you. \`android_interact action=button name=power\` wakes it, but a PIN/pattern lock cannot be passed from here.
- \`unauthorized\` in \`android_devices\` means the USB-debugging prompt has not been accepted ON the device — no tool can fix that from this side. \`offline\` usually means it is still booting.
- \`android_shutdown\` powers off EMULATORS only. A phone is powered off from the phone; here you simply stop using it (the stream reaps itself after five idle minutes).

## Lists and feeds (row-level abstraction)

- List apps aggregate each item into one \`RecyclerView\` child whose text holds the summary AND its counters, with no per-control children to match. \`android_ui_rows\` reads the visible rows: 0-based index, frame, the aggregated label, and counters parsed GENERICALLY from the label (number + classifier token, 中文/English — no app vocabulary). Pass a counter key EXACTLY as listed; the keys round-trip.
- Reach a control inside a row with \`android_tap_row\` at a RELATIVE position (x/y as fractions of that row's frame — a right-side action button is often near x=0.9). Never hand-compute absolute coordinates from a remembered tree: the tool re-locates the row in a FRESH read, and an out-of-range row index FAILS instead of clamping.
- Confirm a row action with \`expect_count={key,delta}\`. If a count key is not among the row's parsed counters the tap is REFUSED before it happens — an unidentifiable control is never probed.

## Logs

- \`android_logs\` is bounded in both modes: \`snapshot\` reads the recent ring (default the last 2m, from a start time computed on the DEVICE clock), \`follow\` captures for \`duration_seconds\` and returns. Output is capped at ~300 lines / 30 KB.
- **An idle emulator emits hundreds of lines a second.** Narrow BEFORE widening the window: \`bundle_id\` (limits the capture to that package's live process via \`--pid\`, so the app must be running), \`tag\`, \`priority\`, \`buffer\`, or a \`grep\` regex.
- To read a crash, use \`buffer:"crash"\` — that buffer holds only fatal Java/native crashes and is where a stack trace actually lives.
- \`android_backtrace\` degrades on purpose. \`kill -3\` + \`/data/anr/\` gives real thread stacks on an emulator or a debuggable build; on a production phone the adb shell user may do neither, and the tool falls back to the crash buffer with \`engine:"logcat-crash"\`. **Always read \`engine\` and \`note\`**: a logcat-crash result is the LAST CRASH, not the current stacks, and an empty one means no crash was recorded — never that the app is healthy.
- \`android_meminfo\` reports \`totalPssKb\`. A single reading means little; a steadily climbing TOTAL PSS across repeated calls while the app sits idle is the Android shape of a leak.

## Choosing the device

\`android_devices\` lists everything adb can see, in ONE array — emulators and phones are the same kind of target here, and the SERIAL is the identity every tool takes. Omit \`device\` and the tools use the streamed device, else the only online one; with two or more attached, the serial is required (the error says so and lists them). \`avds\` names the emulators this machine can boot: pass one to \`android_boot\`, which launches it and waits (minutes on a cold start) before streaming.
`

/**
 * Register the playbook when the host provides the skill service.
 *
 * `ctx.inject(['skills'], …)` rather than a `ctx.skills?.` guard: cordis
 * refuses the mere PROPERTY ACCESS on an undeclared service ("cannot get
 * property \"skills\" without inject") and the throw takes the whole plugin
 * down with it — the optional-service pattern is the scoped inject, exactly
 * like the webServer routes. A profile without the skill service simply never
 * runs the callback.
 */
export function registerAndroidSkill(ctx: Context): () => void {
  // `ctx.inject` returns the scoped FIBER, not a disposer; its own `dispose`
  // is what tears the scope down, so the plugin's teardown list stays uniform.
  const fiber = ctx.inject(['skills'], skillCtx => {
    const skills = (skillCtx as Context & {
      skills: {
        register: (skill: {
          name: string
          description: string
          whenToUse?: string
          content: string
          source: string
        }) => () => void
      }
    }).skills
    skillCtx.effect(() => skills.register({
      name: ANDROID_SKILL_NAME,
      description: ANDROID_SKILL_DESCRIPTION,
      whenToUse: ANDROID_SKILL_WHEN_TO_USE,
      content: ANDROID_SKILL_CONTENT,
      source: 'bundled',
    }), 'dsh-android:skill')
  })
  return () => { void fiber.dispose() }
}
