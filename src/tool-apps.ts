/**
 * The app-lifecycle third of the core tool set: `android_list_apps`,
 * `android_launch_app`, `android_build_run`.
 *
 * Split out of tools.ts purely for the 800-line file rule; `createAndroidTools`
 * composes these three with the five device/stream tools and the whole set is
 * still one factory to the plugin. The enumeration/launch verbs live together
 * because they share one invariant: a package name is NEVER guessed — it is
 * listed (`app-list.ts`), resolved by fragment, or read out of the build AGP
 * just produced (`build-run.ts`).
 * @module @zseven-w/dsh-android/tool-apps
 */

import {
  ToolArgsError,
  defineTool,
  type JsonValue,
  type ToolDefinition,
} from '@deepseek-ai/dsh-tools'
import type { AndroidHostController } from './android-host.js'
import {
  buildRun,
  detectProject,
  launchPackage,
  type AndroidBuildRunResult,
} from './build-run.js'
import {
  filterAndroidApps,
  listAndroidApps,
  noMatchCandidateLines,
  noMatchListingHint,
  resolveAppByName,
  type AndroidApp,
} from './app-list.js'
import {
  appSchema,
  deviceSchema,
  errorMessage,
  renderJson,
  resolveTarget,
  type AndroidDeviceInfo,
} from './tool-support.js'

export interface AndroidListAppsResult {
  device: AndroidDeviceInfo
  count: number
  apps: AndroidApp[]
  /** Package lines from the SAME listing when a query matched nothing. */
  candidates?: string[]
  /** Why the query matched nothing on a SUCCESSFUL listing. */
  hint?: string
}

export interface AndroidLaunchAppResult {
  device: AndroidDeviceInfo
  packageName: string
  launched: true
  /** Set when the call resolved a `name` fragment instead of a package. */
  matched?: string
  /** Whether a running instance was force-stopped first. */
  relaunched?: boolean
}

/** The three app-lifecycle tool definitions. */
export interface AndroidAppTools {
  androidListApps: ToolDefinition
  androidLaunchApp: ToolDefinition
  androidBuildRun: ToolDefinition
}

/** Create the app-lifecycle tools bound to one host controller. */
export function createAndroidAppTools(host: AndroidHostController): AndroidAppTools {
  const androidListApps = defineTool({
    name: 'android_list_apps',
    description: 'List the packages INSTALLED on a device (`pm list packages`), enriched with versionName '
      + 'and whether each is a preinstalled system package. Run this BEFORE opening an app: a package name '
      + 'cannot be guessed — a plausible-looking id (a former app name, or the pattern a sibling app uses) '
      + 'is routinely not the installed one. Filter with `query`, a case-insensitive substring matched '
      + 'against the PACKAGE NAME. Android exposes no display label over adb (an app’s android:label '
      + 'lives in compiled resources that need aapt2 from the SDK), so a Chinese/Japanese label read off '
      + 'the screen will NEVER match here — match a package fragment, or tap the icon with android_find_text '
      + '+ android_tap_text. User-installed packages only by default; include_system:true adds the '
      + 'preinstalled ones. A listing that FAILS throws with the reason instead of returning an empty list, '
      + 'so count:0 always means the device really has no matching package. Concurrency-safe.',
    parameters: {
      device: {
        type: 'string',
        description: 'Target adb serial. Defaults to the streamed device, else the only online one.',
      },
      query: {
        type: 'string',
        description: 'Case-insensitive substring matched against the package name, e.g. "settings", '
          + '"chrome", "com.example". Omit to list everything.',
      },
      include_system: {
        type: 'boolean',
        description: 'Include preinstalled system packages (default false: only user-installed apps, which '
          + 'is what "open <app>" normally means).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          device: { ...deviceSchema, required: true },
          count: { type: 'integer', required: true },
          apps: { type: 'array', required: true, items: appSchema },
          candidates: { type: 'array', items: { type: 'string' } },
          hint: { type: 'string' },
        },
      },
      render: renderJson,
    },
    timeoutMs: 180_000,
    isConcurrencySafe: () => true,
    async execute(args: { device?: string; query?: string; include_system?: boolean }) {
      const { device, summary } = await resolveTarget(host, 'android_list_apps', args.device)
      let apps: AndroidApp[]
      try {
        apps = await listAndroidApps(host.toolchain, device.serial)
      } catch (error) {
        const message = errorMessage(error)
        throw new Error(message.startsWith('android_list_apps:') ? message : `android_list_apps: ${message}`)
      }
      const includeSystem = args.include_system === true
      const query = args.query === undefined ? '' : args.query.trim()
      const filtered = filterAndroidApps(apps, {
        ...(query === '' ? {} : { query }),
        includeSystem,
      })
      // A query that matched nothing surfaces the installed packages from the
      // SAME listing, so the caller can act on a real name instead of guessing.
      const candidates = filtered.length === 0 && query !== '' ? noMatchCandidateLines(apps) : undefined
      const hint = filtered.length === 0 && query !== ''
        ? noMatchListingHint(apps.length, includeSystem)
        : undefined
      return {
        device: summary,
        count: filtered.length,
        apps: filtered,
        ...(hint === undefined ? {} : { hint }),
        ...(candidates === undefined || candidates.length === 0 ? {} : { candidates }),
      } satisfies AndroidListAppsResult
    },
    presentCall: (args: { query?: string }) => ({
      card: 'generic',
      title: args.query === undefined || args.query.trim() === ''
        ? 'List installed packages'
        : `List installed packages matching "${args.query.trim()}"`,
      kind: 'execute',
    }),
  })

  const androidLaunchApp = defineTool({
    name: 'android_launch_app',
    description: 'Launch an already-installed app by resolving its LAUNCHER activity (`monkey -p <pkg> -c '
      + 'android.intent.category.LAUNCHER 1`) — no shell needed. Pass EITHER packageName OR name (exactly '
      + 'one): `name` is a case-insensitive fragment of the package name, resolved against the same listing '
      + 'android_list_apps returns, so several matches come back as a candidate list rather than a guess. '
      + 'Package names of third-party apps CANNOT be guessed; run android_list_apps first when unsure. Use '
      + 'this to OPEN an app; android_build_run is for building and installing one from source. Stable '
      + 'AOSP/GMS packages: Settings com.android.settings, Chrome com.android.chrome, Clock '
      + 'com.google.android.deskclock, Calendar com.google.android.calendar, Camera com.android.camera2, '
      + 'Files com.google.android.documentsui, Play Store com.android.vending.',
    parameters: {
      packageName: {
        type: 'string',
        description: 'Exact package of the installed app, e.g. "com.android.settings". Required unless '
          + 'name is given; passing both is an error.',
      },
      name: {
        type: 'string',
        description: 'Package-name fragment of an installed app, e.g. "settings" or "chrome" '
          + '(case-insensitive). Resolves to exactly one package — several matches come back as a '
          + 'candidate list to choose from.',
      },
      device: {
        type: 'string',
        description: 'Target adb serial. Defaults to the streamed device, else the only online one.',
      },
      relaunch: {
        type: 'boolean',
        description: 'Force-stop a running instance first so the app starts from its launch screen '
          + '(default false: a running app is simply brought to the foreground).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          device: { ...deviceSchema, required: true },
          packageName: { type: 'string', required: true },
          launched: { type: 'boolean', required: true, const: true },
          matched: { type: 'string' },
          relaunched: { type: 'boolean' },
        },
      },
      render: renderJson,
    },
    timeoutMs: 180_000,
    async execute(args: { packageName?: string; name?: string; device?: string; relaunch?: boolean }) {
      const requestedPackage = args.packageName?.trim() ?? ''
      const requestedName = args.name?.trim() ?? ''
      // Two ways to name ONE app, so both together is an argument error rather
      // than a silent precedence rule the model would have to learn.
      if (requestedPackage !== '' && requestedName !== '') {
        throw new ToolArgsError([
          'android_launch_app takes either packageName or name, not both — drop one '
          + `(packageName="${requestedPackage}", name="${requestedName}")`,
        ])
      }
      if (requestedPackage === '' && requestedName === '') {
        throw new ToolArgsError([
          'android_launch_app requires packageName (e.g. "com.android.settings") or name (a package-name '
          + 'fragment such as "settings") — run android_list_apps to see what is installed',
        ])
      }
      const { device, summary } = await resolveTarget(host, 'android_launch_app', args.device)
      let packageName = requestedPackage
      let matched: string | undefined
      if (requestedName !== '') {
        // Name resolution reads the SAME listing android_list_apps returns, but
        // WITH the system packages: "open Settings" must resolve.
        const apps = await listAndroidApps(host.toolchain, device.serial)
        packageName = resolveAppByName('android_launch_app', apps, requestedName, summary.name).packageName
        matched = requestedName
      }
      const relaunch = args.relaunch === true
      if (relaunch) {
        // Best effort: an app that is not running has nothing to force-stop.
        await host.toolchain.shell(device.serial, ['am', 'force-stop', packageName], { timeoutMs: 30_000 })
          .catch(() => undefined)
      }
      try {
        await launchPackage(host.toolchain, device.serial, packageName)
      } catch (error) {
        const message = errorMessage(error)
        throw new Error(message.startsWith('android_launch_app:') ? message : `android_launch_app: ${message}`)
      }
      return {
        device: summary,
        packageName,
        launched: true as const,
        ...(matched === undefined ? {} : { matched }),
        ...(relaunch ? { relaunched: true as boolean } : {}),
      } satisfies AndroidLaunchAppResult
    },
    presentCall: (args: { packageName?: string; name?: string }) => ({
      card: 'generic',
      title: `Launch ${args.packageName ?? args.name ?? 'app'}`,
      kind: 'execute',
      rawInput: {
        ...(args.packageName === undefined ? {} : { packageName: args.packageName }),
        ...(args.name === undefined ? {} : { name: args.name }),
      },
    }),
  })

  const androidBuildRun = defineTool({
    name: 'android_build_run',
    description: 'Build an Android Gradle project, install the APK on a device, and launch it. Runs '
      + '`assembleDebug` (or `assemble<Variant>`) with the project’s ./gradlew wrapper when it has one '
      + '(a PATH `gradle` of the wrong major routinely fails with an unrelated plugin error), finds the '
      + 'newest APK under build/outputs/apk/<variant>/, reads the real applicationId from the '
      + 'output-metadata.json AGP wrote next to it (never guessed), installs with `adb install -r`, and '
      + 'launches the LAUNCHER activity. On build failure the error carries the filtered tail of the Gradle '
      + 'output with the actionable compiler errors. Takes minutes for a cold build.',
    parameters: {
      projectPath: {
        type: 'string',
        required: true,
        description: 'Absolute path to the Android project root (the directory containing '
          + 'settings.gradle or settings.gradle.kts). A module directory inside one also works — the tool '
          + 'climbs to the Gradle root.',
      },
      module: {
        type: 'string',
        description: 'Gradle module to build, e.g. "app" or ":app" (produces :app:assembleDebug). Omit to '
          + 'run the root assemble task, which builds every module.',
      },
      device: {
        type: 'string',
        description: 'Target adb serial. Defaults to the streamed device, else the only online one.',
      },
      variant: {
        type: 'string',
        description: 'Build variant to assemble and install, e.g. "debug" (default) or "release". A '
          + 'release variant must be signable or Gradle will fail.',
      },
      relaunch: {
        type: 'boolean',
        description: 'Force-stop a running instance before launching the freshly installed build '
          + '(default false).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          device: { ...deviceSchema, required: true },
          state: { type: 'string', required: true, const: 'launched' },
          packageName: { type: 'string', required: true },
          apkPath: { type: 'string', required: true },
          projectPath: { type: 'string', required: true },
          task: { type: 'string', required: true },
          variant: { type: 'string', required: true },
          packageSource: {
            type: 'string',
            required: true,
            enum: ['output-metadata', 'build-script', 'manifest'],
          },
          relaunched: { type: 'boolean' },
        },
      },
      render: renderJson,
      presentationMeta: (_args: unknown, value: JsonValue): JsonValue => {
        const result = value as unknown as AndroidBuildRunResult
        return {
          kind: 'android-build-run',
          device: { ...result.device },
          packageName: result.packageName,
          apkPath: result.apkPath,
        }
      },
    },
    timeoutMs: 900_000,
    isConcurrencySafe: () => false,
    async execute(
      args: { projectPath: string; module?: string; device?: string; variant?: string; relaunch?: boolean },
      exec,
    ) {
      const project = detectProject(args.projectPath)
      const { device, summary } = await resolveTarget(host, 'android_build_run', args.device)
      return buildRun({
        project,
        toolchain: host.toolchain,
        device,
        deviceSummary: summary,
        ...(args.module === undefined ? {} : { module: args.module }),
        ...(args.variant === undefined ? {} : { variant: args.variant }),
        ...(args.relaunch === undefined ? {} : { relaunch: args.relaunch }),
        signal: exec.signal,
      })
    },
    presentCall: (args: { projectPath: string }) => ({
      card: 'generic',
      title: `Build & run ${args.projectPath}`,
      kind: 'execute',
      locations: [{ path: args.projectPath }],
    }),
  })

  return { androidListApps, androidLaunchApp, androidBuildRun }
}
