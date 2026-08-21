/**
 * Compact token-styled device picker for the panel header.
 *
 * Replaces the static device-name subtitle: the picker shows the CURRENT
 * streamed device and, when opened, lists what `POST /_dsh/dsh-android/devices`
 * reports. That is ONE array — adb does not distinguish emulators from phones
 * and neither does the stream path — so the picker groups it by `kind`
 * (emulator / physical) purely for readability, each group headed by its own
 * glyph. The list is fetched on every open (focus precedes open) — no polling.
 *
 * AVDs are listed too, but as an UNCLICKABLE hint group: an AVD is not a
 * device until it boots (minutes), and booting belongs to the `android_boot`
 * tool, so each row reads "<avd> · start it with android_boot" and refuses
 * the click. This is the deliberate asymmetry with dsh-ios, where picking a
 * shut-down simulator could boot it in seconds.
 *
 * Picking another device POSTs `/switch-device` (`{device: serial}`); while
 * the request is in flight AND until the new stream (seeded from the returned
 * capability URL) draws its first frame, the picker shows the transitional
 * 切换中… / Switching… state. A failed switch shows the error inline and the
 * selection reverts automatically (the panel meta never changed).
 *
 * Split like the other panel pieces for the static smoke:
 * `AndroidDevicePickerBody` is pure presentation (SSR-able with explicit
 * device lists and switching/error states), `AndroidDevicePicker` binds it to
 * the list-fetch-on-open behavior, and `createAndroidDeviceSwitchController`
 * is a pure, fetcher-injectable state machine.
 * @module @zseven-w/dsh-android/client/android-device-picker
 */

import { useCallback, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { androidCopy, type AndroidLocale } from './copy.js'
import { AndroidSelect, type AndroidSelectGroup } from './android-select.js'
import {
  androidDeviceOnline,
  androidRouteErrorTextOf,
  requestAndroidDevices,
  requestSwitchDevice,
  type AndroidDeviceEntry,
  type AndroidDeviceInfo,
  type AndroidFetcher,
  type AndroidStreamMeta,
  type AndroidSwitchResponse,
} from './protocol.js'

/** Picker chrome over the DSH theme tokens. Exported for the smoke. */
export const ANDROID_DEVICE_PICKER_STYLES: Record<string, CSSProperties> = {
  // In the single-row wrapping header the picker needs a real flex-basis:
  // `flex: 1 1 0` lets it shrink to a sliver. With a 140px basis + 120px
  // floor it claims usable space on the shared line and WRAPS to the next
  // line when the panel narrows instead of collapsing.
  root: {
    minWidth: 120,
    flex: '1 1 140px',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  /** Width/flex tuning merged onto the shared AndroidSelect trigger recipe. */
  trigger: {
    maxWidth: 220,
    minWidth: 100,
    flex: 1,
  },
  switching: {
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 12,
    lineHeight: '16px',
    color: 'var(--dsw-alias-label-secondary)',
    whiteSpace: 'nowrap',
  },
  spinner: {
    flex: 'none',
    width: 11,
    height: 11,
    display: 'inline-block',
    boxSizing: 'border-box',
    borderRadius: '50%',
    border: '2px solid var(--dsw-alias-border-l2)',
    borderTopColor: 'var(--dsw-alias-label-primary)',
    // Animated in the browser through the one plugin-owned keyframes rule
    // (see mountAndroidPanelHost); static in SSR, which the smoke asserts.
    animation: 'dsh-android-switch-spin 0.9s linear infinite',
  },
  error: {
    flex: 'none',
    maxWidth: 180,
    fontSize: 12,
    lineHeight: '16px',
    color: 'var(--dsw-alias-label-secondary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  groupIcon: {
    flex: 'none',
    display: 'block',
    opacity: 0.7,
  },
}

/** The plugin-owned spinner keyframes (injected once by the panel host). */
export const ANDROID_DEVICE_PICKER_KEYFRAMES = '@keyframes dsh-android-switch-spin{to{transform:rotate(360deg)}}'

/** Group-heading glyphs: a desktop monitor for emulators, a phone for real
 * hardware, a disc for the not-yet-booted AVD images. */
export const ANDROID_DEVICE_KIND_ICON_PATHS: Record<'emulator' | 'physical' | 'avd', readonly string[]> = {
  emulator: ['M1.75 2.75 H12.25 V9.75 H1.75 Z', 'M5 12.25 H9'],
  physical: ['M4.25 1.75 H9.75 V12.25 H4.25 Z', 'M6.5 10.4 H7.5'],
  avd: ['M7 2.5a4.5 4.5 0 1 0 .01 0', 'M7 6a1 1 0 1 0 .01 0'],
}

/** One inline group glyph (14px, currentColor — the heading's token color). */
export function AndroidDeviceKindIcon({ kind }: { kind: 'emulator' | 'physical' | 'avd' }): React.JSX.Element {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={ANDROID_DEVICE_PICKER_STYLES.groupIcon}
      aria-hidden="true"
      focusable={false}
      data-android-device-kind-icon={kind}
    >
      {ANDROID_DEVICE_KIND_ICON_PATHS[kind].map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  )
}

/** One kind group for the picker (emulators first, then physical devices). */
export interface AndroidDeviceGroup {
  kind: 'emulator' | 'physical'
  devices: AndroidDeviceEntry[]
}

/** The human label of one device row: the model, falling back to the serial. */
export function androidDeviceLabelOf(device: { serial: string; model?: string }): string {
  return device.model !== undefined && device.model !== '' ? device.model : device.serial
}

/**
 * Group the listing by device kind, preserving the host's order inside each
 * group (online first, then serial — the client never re-sorts). When the
 * current device is missing from the listing (stale list, fetch failure,
 * fresh switch) it is injected so the select's value always has a matching
 * option and the picker keeps showing the device.
 */
export function androidDeviceGroupsOf(
  devices: readonly AndroidDeviceEntry[],
  current?: AndroidDeviceInfo,
): AndroidDeviceGroup[] {
  const byKind = new Map<'emulator' | 'physical', AndroidDeviceEntry[]>()
  for (const device of devices) {
    const list = byKind.get(device.kind)
    if (list === undefined) byKind.set(device.kind, [device])
    else list.push(device)
  }
  const serial = current?.serial
  if (typeof serial === 'string' && serial !== '' && !devices.some(device => device.serial === serial)) {
    // An emulator serial always looks like `emulator-5554`; anything else is
    // assumed physical. Only used for the injected placeholder row.
    const kind = serial.startsWith('emulator-') ? 'emulator' as const : 'physical' as const
    const entry: AndroidDeviceEntry = {
      serial,
      state: typeof current?.state === 'string' && current.state !== '' ? current.state : 'device',
      kind,
      ...(typeof current?.name === 'string' && current.name !== '' ? { model: current.name } : {}),
    }
    const list = byKind.get(kind)
    if (list === undefined) byKind.set(kind, [entry])
    else list.unshift(entry)
  }
  const groups: AndroidDeviceGroup[] = []
  for (const kind of ['emulator', 'physical'] as const) {
    const list = byKind.get(kind)
    if (list !== undefined && list.length > 0) groups.push({ kind, devices: list })
  }
  return groups
}

/**
 * Build the AndroidSelect groups: one group per device kind (with its glyph,
 * the streamed device marked ● and the other online ones with a hollow ring)
 * plus the DISABLED AVD hint group at the bottom. Exported so the smoke can
 * render `AndroidSelectMenu` with the exact groups.
 */
export function androidDeviceSelectGroupsOf(
  devices: readonly AndroidDeviceEntry[],
  avds: readonly string[],
  currentDevice: AndroidDeviceInfo | undefined,
  locale: AndroidLocale,
): AndroidSelectGroup[] {
  const copy = androidCopy(locale)
  const groups: AndroidSelectGroup[] = androidDeviceGroupsOf(devices, currentDevice).map(group => ({
    id: `kind-${group.kind}`,
    label: group.kind === 'emulator' ? copy.deviceEmulators : copy.devicePhysical,
    icon: <AndroidDeviceKindIcon kind={group.kind} />,
    dataAttrs: { 'data-android-device-kind-group': group.kind },
    options: group.devices.map(device => {
      const online = androidDeviceOnline(device)
      const streaming = device.serial === currentDevice?.serial
      // Three readable states: the STREAMED device gets the same green the
      // panel's ● 实时 readout uses, other online devices get a hollow ring,
      // offline/unauthorized ones get no dot at all.
      const markerTone = streaming ? 'active' as const : online ? 'idle' as const : undefined
      const state = streaming ? copy.deviceStreaming : online ? copy.deviceOnline : device.state
      const label = androidDeviceLabelOf(device)
      return {
        value: device.serial,
        label,
        ...(markerTone === undefined ? {} : { markerTone }),
        // adb refuses everything on a non-online device; picking one would
        // only ever produce a coded 409, so the row is inert.
        disabled: !online,
        ariaLabel: `${label}, ${state}`,
        title: `${label} · ${device.serial} · ${state}`,
        dataAttrs: {
          'data-android-device-serial': device.serial,
          'data-android-device-online': online ? 'true' : 'false',
          'data-android-device-streaming': streaming ? 'true' : 'false',
        },
      }
    }),
  }))
  if (groups.length === 0) {
    groups.push({
      id: 'devices-empty',
      disabled: true,
      dataAttrs: { 'data-android-devices-empty': 'true' },
      options: [{ value: '', label: copy.deviceNone, disabled: true }],
    })
  }
  if (avds.length > 0) {
    groups.push({
      id: 'avds',
      label: copy.deviceAvds,
      icon: <AndroidDeviceKindIcon kind="avd" />,
      disabled: true,
      dataAttrs: { 'data-android-avds-group': 'true' },
      options: avds.map(avd => ({
        value: '',
        label: `${avd} · ${copy.deviceAvdHint}`,
        disabled: true,
        title: `${avd} · ${copy.deviceAvdHint}`,
        dataAttrs: { 'data-android-avd': avd },
      })),
    })
  }
  return groups
}

export interface AndroidDevicePickerBodyProps {
  /** Devices from the host listing (may be empty). */
  devices: readonly AndroidDeviceEntry[]
  /** AVD names from the host listing (rendered as an inert hint group). */
  avds?: readonly string[]
  /** The current streamed device (select value + fallback option). */
  currentDevice?: AndroidDeviceInfo
  /** Transitional state: switch POST in flight or the new grant not yet live. */
  switching: boolean
  /** Inline switch-failure message (empty → hidden). */
  error: string
  locale: AndroidLocale
  onSelect: (serial: string) => void
  /** Fires when the picker opens/focuses — the list-refresh hook. */
  onOpen?: () => void
}

/**
 * Pure picker presentation: the token-styled select with one group per device
 * kind, the inert AVD hint group, the transitional 切换中… readout and the
 * inline switch error. SSR-safe — no effects, no fetch.
 */
export function AndroidDevicePickerBody({
  devices,
  avds = [],
  currentDevice,
  switching,
  error,
  locale,
  onSelect,
  onOpen,
}: AndroidDevicePickerBodyProps): React.JSX.Element {
  const copy = androidCopy(locale)
  const currentSerial = typeof currentDevice?.serial === 'string' ? currentDevice.serial : ''
  const selectGroups = androidDeviceSelectGroupsOf(devices, avds, currentDevice, locale)
  return (
    <div style={ANDROID_DEVICE_PICKER_STYLES.root} data-android-device-picker="true">
      <AndroidSelect
        value={currentSerial}
        groups={selectGroups}
        onChange={onSelect}
        onOpen={onOpen}
        disabled={switching}
        ariaLabel={copy.devicePicker}
        triggerStyle={ANDROID_DEVICE_PICKER_STYLES.trigger}
        dataAttrs={{
          'data-android-device-picker-select': 'true',
          'data-android-device-current': currentSerial,
          'data-android-device-switching': switching ? 'true' : 'false',
        }}
      />
      {switching ? (
        <span
          style={ANDROID_DEVICE_PICKER_STYLES.switching}
          role="status"
          data-android-device-switching-state="true"
        >
          <span style={ANDROID_DEVICE_PICKER_STYLES.spinner} aria-hidden="true" data-android-device-spinner="true" />
          {copy.deviceSwitching}
        </span>
      ) : null}
      {!switching && error !== '' ? (
        <span style={ANDROID_DEVICE_PICKER_STYLES.error} role="alert" data-android-device-error="true">
          {`${copy.switchFailed}: ${error}`}
        </span>
      ) : null}
    </div>
  )
}

export interface AndroidDevicePickerProps {
  fetcher?: AndroidFetcher
  /** The current streamed device (select value + fallback option). */
  currentDevice?: AndroidDeviceInfo
  /** Transitional state owned by the panel (switch in flight / grant pending). */
  switching: boolean
  /** Inline switch-failure message owned by the panel. */
  error: string
  locale: AndroidLocale
  onSelect: (serial: string) => void
}

/**
 * Connected picker: refreshes the device list from the host on every open
 * (focus precedes open — no polling, no fetch during render/SSR). A failed
 * listing keeps the previous/current-device-only state and is retried on the
 * next open.
 */
export function AndroidDevicePicker({
  fetcher,
  currentDevice,
  switching,
  error,
  locale,
  onSelect,
}: AndroidDevicePickerProps): React.JSX.Element {
  const [devices, setDevices] = useState<AndroidDeviceEntry[]>([])
  const [avds, setAvds] = useState<string[]>([])
  const inflightRef = useRef(false)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const onOpen = useCallback((): void => {
    if (inflightRef.current) return
    inflightRef.current = true
    void requestAndroidDevices(fetcherRef.current ?? fetch).then(listing => {
      inflightRef.current = false
      setDevices(listing.devices)
      setAvds(listing.avds)
    })
  }, [])
  return (
    <AndroidDevicePickerBody
      devices={devices}
      avds={avds}
      currentDevice={currentDevice}
      switching={switching}
      error={error}
      locale={locale}
      onSelect={onSelect}
      onOpen={onOpen}
    />
  )
}

/** Synthetic stream meta for the switched device — the meta the panel adopts
 * after a switch (the same capsule-style synthetic source
 * `androidSwitchedPanelRequestOf` wraps for the store/registry). */
export function androidSwitchedStreamMetaOf(result: AndroidSwitchResponse): AndroidStreamMeta {
  const device: AndroidDeviceInfo = {
    serial: result.device,
    ...(typeof result.deviceName === 'string' && result.deviceName !== ''
      ? { name: result.deviceName }
      : {}),
  }
  return { kind: 'android-stream', device }
}

export interface AndroidDeviceSwitchControllerOptions {
  /** Fetcher to POST the switch-device endpoint with (defaults to fetch). */
  fetcher?: AndroidFetcher
  /** Locale table used to localize the route's failure code (androidCopy). */
  copy?: Record<string, string>
  /** Observes the transitional flag (true on pick, false on failure; on
   * success the panel clears it once the new stream draws a frame). */
  onSwitchingChange?: (switching: boolean) => void
  /** The parsed capability + device identity of a successful switch. */
  onSwitched: (result: AndroidSwitchResponse) => void
  /** The failure message of a rejected switch (409/5xx/parse failure). */
  onError: (message: string) => void
}

export interface AndroidDeviceSwitchController {
  /** POST the switch-device route for `serial`; false while one is in flight
   * (the client-side half of the no-concurrent-switches contract). */
  switchTo: (serial: string) => boolean
  dispose: () => void
}

/**
 * The pure device-switch state machine: POSTs `/switch-device` `{device}`,
 * guards against concurrent switches, and reports the parsed result or the
 * failure. The dev-panel-smoke script drives it with a mocked fetcher; the
 * panel binds it to its seeded-grant flow.
 */
export function createAndroidDeviceSwitchController(
  options: AndroidDeviceSwitchControllerOptions,
): AndroidDeviceSwitchController {
  const fetcher = options.fetcher ?? fetch
  let inflight = false
  let disposed = false
  return {
    switchTo(serial) {
      if (disposed || inflight || serial === '') return false
      inflight = true
      options.onSwitchingChange?.(true)
      void requestSwitchDevice(fetcher, serial).then(result => {
        inflight = false
        if (disposed) return
        if (result.ok) {
          options.onSwitched(result.switched)
          // Switching stays true: the panel clears it when the stream seeded
          // from the returned capability draws its first frame (or falls
          // back) — the spinner spans "old stream closes → new grant lands".
        } else {
          options.onError(androidRouteErrorTextOf(result, options.copy ?? {}))
          options.onSwitchingChange?.(false)
        }
      })
      return true
    },
    dispose() {
      disposed = true
    },
  }
}
