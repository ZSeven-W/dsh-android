/**
 * Development smoke test for the host-independent Android QA driver
 * (src/qa-driver.ts → lib/qa-driver.js).
 *
 * Run after `pnpm run build` (the suite imports the COMPILED lib/*.js):
 *   node scripts/dev-qa-driver-smoke.mjs
 *
 * PURELY STATIC — no device, no adb. The driver is exercised through its DI
 * seam with a fake AndroidQaToolchain that records every shell/execOut call, so
 * the focused contract behaviors can be verified without a device:
 *
 *   A. host-free import (qa-driver.js imports only relative + node: builtins)
 *   B. password flag/value suppression + stable repeated resource-ids
 *   C. selected-device routing (explicit serial, never an implicit first device)
 *   D. unavailable device (discover returns a fact, [] for none)
 *   E. foreground mismatch + read errors (honest receipt / throw)
 *   F. cancellation / dispose (AbortError vs disposed, no device state reset)
 *   G. launchApp honest receipt (never assert success from exit 0)
 *   H. tap/type/scroll/key/screenshot coordinate + command routing
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStepReporter, expectThrow, TINY_PNG_B64 } from './_smoke-harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const { step, finish } = createStepReporter()

let driver
try {
  driver = await import(join(root, 'lib', 'qa-driver.js'))
} catch (error) {
  step('import lib/qa-driver.js', 'SKIP', 'build not available yet: ' + (error instanceof Error ? error.message : String(error)))
  console.log('SKIPPED — run pnpm run build (or re-run after integration) and try again.')
  process.exitCode = 0
}

if (driver !== undefined) {
  const { createAndroidQaBackend, ANDROID_QA_COORDINATE_SPACE } = driver

  // ── A. host-free import ────────────────────────────────────────────────────
  step('createAndroidQaBackend is exported', typeof createAndroidQaBackend === 'function')
  step('coordinate space is declared display-pixels', ANDROID_QA_COORDINATE_SPACE === 'display-pixels')
  {
    const source = readFileSync(join(root, 'lib', 'qa-driver.js'), 'utf8')
    const specifiers = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1])
    const bare = specifiers.filter(spec => !spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('node:'))
    step(
      'host-free: qa-driver.js imports only relative paths + node builtins',
      bare.length === 0,
      bare.join(', '),
    )
  }
  {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    step(
      'package.json exposes ./driver -> lib/qa-driver.js',
      pkg.exports?.['./driver']?.default === './lib/qa-driver.js',
      JSON.stringify(pkg.exports?.['./driver']),
    )
  }

  // ── fixture: one password field + two rows sharing a resource-id ──────────
  const XML = [
    "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",
    '<hierarchy rotation="0">',
    '<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]">',
    '<node index="0" text="Username" resource-id="com.example.app:id/username" class="android.widget.EditText" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="false" focused="true" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[50,200][1030,320]" />',
    '<node index="1" text="hunter2secret" resource-id="com.example.app:id/password" class="android.widget.EditText" package="com.example.app" content-desc="Password field" checkable="false" checked="false" clickable="true" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="true" selected="false" bounds="[50,400][1030,520]" />',
    '<node index="2" text="" resource-id="com.example.app:id/button" class="android.widget.Button" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[50,600][1030,720]" />',
    '<node index="3" text="Row A" resource-id="com.example.app:id/row" class="android.widget.TextView" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[50,800][1030,920]" />',
    '<node index="4" text="Row B" resource-id="com.example.app:id/row" class="android.widget.TextView" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[50,1000][1030,1120]" />',
    '</node></hierarchy>',
  ].join('')

  function makeFake(options = {}) {
    const { devices, xml = XML, screen = { width: 1080, height: 2400 }, foreground, foregroundError, imeList = 'com.android.adbkeyboard', monkeyOutput = 'Events injected: 1' } = options
    const calls = { shell: [], execOut: [], listDevices: 0, deviceDetails: 0, screenSize: 0 }
    return {
      calls,
      toolchain: {
        available: true,
        requireAdb() { return '/fake/adb' },
        async listDevices() { calls.listDevices += 1; return devices ?? [] },
        async onlineDevices() { return (devices ?? []).filter(device => device.state === 'device') },
        async deviceDetails(device) {
          calls.deviceDetails += 1
          return { serial: device.serial, model: 'FakeModel', manufacturer: 'Fake Inc', androidVersion: '14', sdk: 34 }
        },
        async screenSize() { calls.screenSize += 1; return screen },
        async shell(serial, command, options) {
          calls.shell.push({ serial, command, options })
          if (command[0] === 'dumpsys') {
            if (foregroundError !== undefined) throw new Error(foregroundError)
            if (command[1] === 'window') {
              return foreground === undefined ? '' : '  mCurrentFocus=Window{abc123 u0 ' + foreground + '}'
            }
            if (command[1] === 'activity') {
              return foreground === undefined ? '' : '  topResumedActivity: ActivityRecord{abc123 u0 ' + foreground + '} t42'
            }
          }
          if (command[0] === 'ime') return imeList
          if (command[0] === 'monkey') return monkeyOutput
          return ''
        },
        async execOut(serial, command, options) {
          calls.execOut.push({ serial, command, options })
          if (command[0] === 'uiautomator') {
            return Buffer.from(xml + 'UI hierchary dumped to: /dev/tty', 'utf8')
          }
          if (command[0] === 'screencap') return Buffer.from(TINY_PNG_B64, 'base64')
          throw new Error('unexpected exec-out: ' + command.join(' '))
        },
      },
    }
  }

  function flatten(nodes) {
    const out = []
    const walk = list => {
      for (const node of list) {
        out.push(node)
        walk(node.children ?? [])
      }
    }
    walk(nodes)
    return out
  }

  /**
   * A minimal hierarchy for a given Surface.ROTATION and NATURAL (portrait)
   * dimensions. The window root's bounds always face the CURRENT display, so a
   * 1/3 rotation widens the bounds (the property the driver must reproduce from
   * `wm size`'s never-rotating natural geometry + the tree rotation metadata).
   */
  function rotationXml(rotation, natural = { width: 1080, height: 2400 }) {
    const landscape = rotation === 1 || rotation === 3
    const width = landscape ? natural.height : natural.width
    const height = landscape ? natural.width : natural.height
    return [
      "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",
      `<hierarchy rotation="${rotation}">`,
      '<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false"',
      ` bounds="[0,0][${width},${height}]" />`,
      '</hierarchy>',
    ].join('')
  }

  /** Compute an oriented (rotation-aware) scroll path's swipe numbers exactly. */
  function orientedSwipe(natural, rotation, direction, amount = 0.6) {
    const landscape = rotation === 1 || rotation === 3
    const width = landscape ? natural.height : natural.width
    const height = landscape ? natural.width : natural.height
    const anchor = 0.5
    const min = 0.08
    const max = 0.92
    const clamp = value => Math.min(max, Math.max(min, value))
    const vertical = direction === 'up' || direction === 'down'
    const delta = (direction === 'down' || direction === 'right' ? -1 : 1) * amount
    const from = clamp(anchor)
    const toValue = clamp(from + delta)
    const path = vertical
      ? [Math.round(anchor * width), Math.round(from * height), Math.round(anchor * width), Math.round(toValue * height)]
      : [Math.round(from * width), Math.round(anchor * height), Math.round(toValue * width), Math.round(anchor * height)]
    return path.map(value => String(value))
  }

  // ── B. password suppression + repeated ids ────────────────────────────────
  {
    const backend = createAndroidQaBackend({ toolchain: makeFake({ foreground: 'com.example.app/com.example.app.MainActivity' }).toolchain })
    const observed = await backend.observe('emulator-5554')
    const nodes = flatten(observed.nodes)
    const password = nodes.find(node => node.resourceId === 'com.example.app:id/password')
    const username = nodes.find(node => node.resourceId === 'com.example.app:id/username')
    const rows = nodes.filter(node => node.resourceId === 'com.example.app:id/row')

    step('observe screen/coordinateSpace/budget', observed.screen.width === 1080 && observed.screen.height === 2400
      && observed.coordinateSpace === 'display-pixels' && observed.budgetBytes === 40 * 1024)
    step('observe nodeCount is the emitted count', observed.nodeCount === 6, String(observed.nodeCount))
    step('password flag preserved', password?.password === true && password.role === 'EditText' && password.className === 'android.widget.EditText')
    step(
      'password text/contentDesc/name withheld',
      password !== undefined && password.text === undefined && password.contentDesc === undefined && password.name === undefined,
      JSON.stringify({ text: password?.text, contentDesc: password?.contentDesc, name: password?.name }),
    )
    step('non-password node keeps text/name', username?.text === 'Username' && username.name === 'Username' && username.password === false)
    step(
      'repeated resource-ids stay distinct nodes',
      rows.length === 2 && rows[0].text === 'Row A' && rows[1].text === 'Row B',
      rows.map(row => row.text).join('|'),
    )
    step('per-node package identity surfaced', username?.packageName === 'com.example.app')
    step('foreground app identity surfaced honestly', observed.packageName === 'com.example.app'
      && observed.foreground?.activity === 'com.example.app.MainActivity'
      && observed.readError === undefined)
    await backend.dispose()
  }

  // ── C. selected-device routing (no implicit first device) ─────────────────
  {
    const fake = makeFake({})
    const backend = createAndroidQaBackend({ toolchain: fake.toolchain })
    await backend.tap('emulator-5554', 100.6, 200.4)
    const tap = fake.calls.shell.find(call => call.command[0] === 'input' && call.command[1] === 'tap')
    step(
      'tap routes to the explicit serial with rounded pixel coords',
      tap !== undefined && tap.serial === 'emulator-5554' && tap.command[2] === '101' && tap.command[3] === '200',
      JSON.stringify(tap?.command),
    )
    await expectThrow(
      step,
      'missing serial is refused, never auto-selected',
      () => backend.tap('', 1, 2),
      /serial is required.*never selects a device implicitly/,
    )
    await backend.dispose()
  }

  // ── D. unavailable device ─────────────────────────────────────────────────
  {
    const none = createAndroidQaBackend({ toolchain: makeFake({ devices: [] }).toolchain })
    step('discover returns [] for no devices (a fact, not a throw)', (await none.discover()).length === 0)
    await none.dispose()

    const fake = makeFake({ devices: [
      { serial: 'emulator-5554', state: 'device', emulator: true, model: 'sdk_gphone', product: 'sdk_gphone', transportId: '1' },
      { serial: 'usb-123', state: 'offline', emulator: false },
      { serial: 'unauth-1', state: 'unauthorized', emulator: false },
    ] })
    const backend = createAndroidQaBackend({ toolchain: fake.toolchain })
    const devices = await backend.discover()
    step(
      'discover lists every state incl. offline/unauthorized',
      devices.length === 3 && devices.some(device => device.state === 'offline') && devices.some(device => device.state === 'unauthorized'),
      devices.map(device => device.state).join(','),
    )
    step(
      'getprop details only for online devices',
      fake.calls.deviceDetails === 1 && devices.find(device => device.serial === 'emulator-5554')?.androidVersion === '14',
      'deviceDetails=' + fake.calls.deviceDetails,
    )
    await backend.dispose()
  }

  // ── E. foreground mismatch + read errors ──────────────────────────────────
  {
    const backend = createAndroidQaBackend({ toolchain: makeFake({ foreground: 'com.other.app/com.other.app.Main' }).toolchain })
    const foreground = await backend.foregroundApp('emulator-5554')
    step(
      'foreground mismatch is an honest receipt, not an assertion',
      foreground.packageName === 'com.other.app' && foreground.packageName !== 'com.example.app' && foreground.raw.startsWith('mCurrentFocus='),
      foreground.packageName,
    )
    await backend.dispose()

    const unreadable = createAndroidQaBackend({ toolchain: makeFake({ foregroundError: 'adb: device offline' }).toolchain })
    await expectThrow(
      step,
      'foreground read error throws (distinguish unreadable from not-matching)',
      () => unreadable.foregroundApp('emulator-5554'),
      /could not read the foreground app.*device offline/,
    )
    const observed = await unreadable.observe('emulator-5554')
    step('observe surfaces the foreground read error without failing the DUMP', /device offline/.test(observed.readError ?? '')
      && observed.nodes.length > 0)
    await unreadable.dispose()
  }

  // ── F. cancellation / dispose ─────────────────────────────────────────────
  {
    const backend = createAndroidQaBackend({ toolchain: makeFake({}).toolchain })
    await backend.dispose()
    step('disposed flag after dispose', backend.disposed === true)
    await expectThrow(
      step,
      'post-dispose call rejects with a disposed error',
      () => backend.tap('emulator-5554', 1, 1),
      /QA backend is disposed/,
    )

    const controller = new AbortController()
    const cancellable = createAndroidQaBackend({ toolchain: makeFake({}).toolchain, signal: controller.signal })
    controller.abort()
    let aborted = false

    try {
      await cancellable.discover()
    } catch (error) {
      aborted = error instanceof Error && error.name === 'AbortError'
    }
    step('master-signal abort rejects future calls with AbortError', aborted)
    await cancellable.dispose()
  }

  // ── G. launchApp honest receipt ───────────────────────────────────────────
  {
    const backend = createAndroidQaBackend({ toolchain: makeFake({}).toolchain })
    const launch = await backend.launchApp('emulator-5554', 'com.example.app')
    step(
      'launchApp returns the monkey receipt (never asserts launch success)',
      launch.serial === 'emulator-5554' && launch.packageName === 'com.example.app'
        && launch.output.includes('Events injected: 1')
        && launch.command.join(' ').startsWith('monkey -p com.example.app'),
      launch.output.trim(),
    )
    await backend.dispose()

    const failing = createAndroidQaBackend({ toolchain: makeFake({ monkeyOutput: 'No activities found to run; monkey aborted' }).toolchain })
    await expectThrow(
      step,
      'known failure line throws (no-activities)',
      () => failing.launchApp('emulator-5554', 'com.example.app'),
      /No activities found/,
    )
    await failing.dispose()
  }

  // ── H. type / scroll / key / screenshot ───────────────────────────────────
  {
    const fake = makeFake({})
    const backend = createAndroidQaBackend({ toolchain: fake.toolchain })

    await backend.type('emulator-5554', 'hello world')
    const type = fake.calls.shell.find(call => call.command[0] === 'input' && call.command[1] === 'text')
    step('ASCII type escapes spaces to %s', type?.command[2] === 'hello%sworld', JSON.stringify(type?.command))

    const refuse = createAndroidQaBackend({ toolchain: makeFake({ imeList: '' }).toolchain })
    await expectThrow(
      step,
      'non-ASCII type refused with the ADBKeyboard hint when the IME is absent',
      () => refuse.type('emulator-5554', '你好'),
      /ADBKeyboard IME/,
    )
    await refuse.dispose()

    await backend.scroll('emulator-5554', 'down', 0.6)
    const swipe = fake.calls.shell.find(call => call.command[0] === 'input' && call.command[1] === 'swipe')
    step(
      'scroll clamps the finger path into the 8%..92% band (content down = finger up)',
      swipe !== undefined && swipe.command.slice(2, 6).join(',') === '540,1200,540,192' && swipe.command[6] === '300',
      JSON.stringify(swipe?.command),
    )

    await backend.key('emulator-5554', 'back')
    const key = fake.calls.shell.find(call => call.command[0] === 'input' && call.command[1] === 'keyevent')
    step('key maps button name to KEYCODE', key?.command[2] === 'KEYCODE_BACK', JSON.stringify(key?.command))

    const shot = await backend.screenshot('emulator-5554')
    step('screenshot returns png + dimensions', Buffer.isBuffer(shot.png) && shot.width === 1 && shot.height === 1
      && shot.serial === 'emulator-5554')
    await backend.dispose()
  }

  // ── I. orientation-aware observe screen (all four rotations) ───────────────
  // Reproduces the live regression: `wm size` returns the NATURAL portrait
  // 1440x2560 even at ROTATION_1, but the actual display (and screenshot) is
  // 2560x1440. The driver must map the natural geometry through the FRESH
  // UI-tree rotation instead of overwriting tree geometry with the raw wm size.
  {
    const natural = { width: 1440, height: 2560 }
    for (const rotation of [0, 1, 2, 3]) {
      const fake = makeFake({ xml: rotationXml(rotation, natural), screen: natural })
      const backend = createAndroidQaBackend({ toolchain: fake.toolchain })
      const observed = await backend.observe('emulator-5554')
      const landscape = rotation === 1 || rotation === 3
      const expectedWidth = landscape ? natural.height : natural.width
      const expectedHeight = landscape ? natural.width : natural.height
      step(
        `observe screen follows rotation ${rotation} (${expectedWidth}x${expectedHeight})`,
        observed.screen.width === expectedWidth && observed.screen.height === expectedHeight
          && observed.rotation === rotation,
        JSON.stringify({ screen: observed.screen, rotation: observed.rotation }),
      )
      await backend.dispose()
    }
    // Explicit mismatch-reproduction assertion (the live rotation-diagnostic
    // shape): observe at rotation 1 must agree with the rotated screenshot, not
    // the natural portrait wm size.
    const mismatch = makeFake({ xml: rotationXml(1, natural), screen: natural })
    const mismatchBackend = createAndroidQaBackend({ toolchain: mismatch.toolchain })
    const observed = await mismatchBackend.observe('emulator-5554')
    step(
      'observe screen at ROTATION_1 is 2560x1440 (not natural 1440x2560)',
      observed.screen.width === 2560 && observed.screen.height === 1440 && observed.rotation === 1,
      JSON.stringify(observed.screen),
    )
    await mismatchBackend.dispose()
  }

  // ── J. orientation-aware scroll endpoints stay inside the display ─────────
  {
    const natural = { width: 1440, height: 2560 }
    const rotated = makeFake({ xml: rotationXml(1, natural), screen: natural })
    const rotatedBackend = createAndroidQaBackend({ toolchain: rotated.toolchain })
    await rotatedBackend.scroll('emulator-5554', 'down', 0.6)
    const vertical = rotated.calls.shell.find(call => call.command[0] === 'input' && call.command[1] === 'swipe')
    const verticalExpected = orientedSwipe(natural, 1, 'down', 0.6)
    step(
      'vertical scroll at ROTATION_1 uses landscape 2560x1440 endpoints (inside the display)',
      vertical !== undefined && vertical.command.slice(2, 6).join(',') === verticalExpected.join(',')
        && Number(vertical.command[3]) >= 0 && Number(vertical.command[3]) < 1440
        && Number(vertical.command[5]) >= 0 && Number(vertical.command[5]) < 1440,
      JSON.stringify(vertical?.command),
    )
    await rotatedBackend.dispose()

    const rot3 = makeFake({ xml: rotationXml(3, natural), screen: natural })
    const rot3Backend = createAndroidQaBackend({ toolchain: rot3.toolchain })
    await rot3Backend.scroll('emulator-5554', 'right', 0.5)
    const horizontal = rot3.calls.shell.find(call => call.command[0] === 'input' && call.command[1] === 'swipe')
    const horizontalExpected = orientedSwipe(natural, 3, 'right', 0.5)
    step(
      'horizontal scroll at ROTATION_3 stays inside the oriented display',
      horizontal !== undefined && horizontal.command.slice(2, 6).join(',') === horizontalExpected.join(',')
        && Number(horizontal.command[2]) >= 0 && Number(horizontal.command[2]) <= 2560
        && Number(horizontal.command[4]) >= 0 && Number(horizontal.command[4]) <= 2560,
      JSON.stringify(horizontal?.command),
    )
    await rot3Backend.dispose()
  }

  // ── K. rotation change between calls: no stale cached coordinates ─────────
  {
    const natural0 = { width: 1080, height: 2400 }
    const natural1 = { width: 1440, height: 2560 }
    let current = { xml: rotationXml(0, natural0), screen: { ...natural0 } }
    const calls = { shell: [] }
    const toolchain = {
      available: true,
      requireAdb() { return '/fake/adb' },
      async listDevices() { return [] },
      async onlineDevices() { return [] },
      async deviceDetails() { return { serial: 'emulator-5554' } },
      async screenSize() { return { ...current.screen } },
      async shell(serial, command, options) {
        calls.shell.push({ serial, command, options })
        return ''
      },
      async execOut(serial, command, options) {
        if (command[0] === 'uiautomator') {
          return Buffer.from(current.xml + 'UI hierchary dumped to: /dev/tty', 'utf8')
        }
        if (command[0] === 'screencap') return Buffer.from(TINY_PNG_B64, 'base64')
        throw new Error('unexpected exec-out in rotation-change fake: ' + command.join(' '))
      },
    }
    const backend = createAndroidQaBackend({ toolchain })
    await backend.scroll('emulator-5554', 'down', 0.6)
    const first = calls.shell.find(call => call.command[0] === 'input' && call.command[1] === 'swipe')
    step(
      'scroll call 1 uses its fresh portrait rotation (no stale landscape coords)',
      first !== undefined && first.command.slice(2, 6).join(',') === orientedSwipe(natural0, 0, 'down', 0.6).join(','),
      JSON.stringify(first?.command),
    )

    // Rotate between calls: the SAME backend must pick up the NEW rotation.
    current = { xml: rotationXml(1, natural1), screen: { ...natural1 } }
    await backend.scroll('emulator-5554', 'down', 0.6)
    const swipes = calls.shell.filter(call => call.command[0] === 'input' && call.command[1] === 'swipe')
    const second = swipes[swipes.length - 1]
    step(
      'scroll call 2 after rotation uses the fresh landscape geometry (no stale cache)',
      second !== undefined && second.command.slice(2, 6).join(',') === orientedSwipe(natural1, 1, 'down', 0.6).join(','),
      JSON.stringify(second?.command),
    )
    await backend.dispose()
  }

  finish()
}
