/**
 * Live device stream card (`android_boot`).
 *
 * The device display lives in the persistent right-side panel, so this card
 * renders NO imagery: the conversation stream shows a compact one-line summary
 * (tool title, device name, status badge, "open in sidebar" affordance) and
 * clicking the row opens the panel via the row-click trigger.
 *
 * While settled with a parseable `android-stream` meta, the card registers its
 * result as an openable source for the device panel and — because `android_boot`
 * is the explicit START verb — auto-opens the panel exactly once.
 */

import { useEffect, useMemo } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { AndroidFetcher } from './protocol.js'
import { resolveAndroidMeta, type AndroidMetaSource } from './android-meta-hydrate.js'
import { androidCopy, type AndroidLocale } from './copy.js'
import { androidResultTextOf } from './android-result.js'
import { CARD_STYLES } from './card-styles.js'
import { useAndroidPanelSource, type AndroidPanelSource } from './android-panel-trigger.js'
import {
  androidPanelAutoOpenActivatedAt,
  androidPanelAutoOpenKey,
  androidPanelAutoOpenShouldOpen,
  forgetAndroidPanelAutoOpenCall,
  rememberAndroidPanelAutoOpenCall,
  takeAndroidPanelAutoOpenCall,
} from './android-panel-auto-open.js'

/** Injectable surfaces every card accepts (tests, headless hosts). */
export interface AndroidCardOptions {
  fetcher?: AndroidFetcher
  colorScheme?: 'light' | 'dark'
  locale?: string
  /** Auto-open callback: fire once when a settled START result should open
   * the panel. */
  autoOpen?: (source: AndroidPanelSource) => void
}

/**
 * Shared compact card chrome: a one-line-ish head with the tool title, the
 * device name, a status badge and the non-interactive "open in sidebar"
 * affordance (the row click itself opens the panel, so the cue never swallows
 * the gesture), plus an optional slim body for state copy/meta.
 */
export function androidCardChrome({
  title,
  actionLabel,
  actionId,
  deviceLabel,
  badge,
  dataState,
  toolName,
  locale,
  openable,
  children,
  metaSource,
}: {
  title: string
  /** Small secondary action sub-label right after the title. */
  actionLabel?: string
  /** Stable action id for the `data-android-card-action` marker. */
  actionId?: string
  deviceLabel?: string
  badge?: React.ReactNode
  dataState: 'running' | 'live' | 'fallback' | 'error'
  toolName: string
  locale: AndroidLocale
  openable: boolean
  children?: React.ReactNode
  /** Origin of the card's meta; rendered as a data attr for debuggability. */
  metaSource?: AndroidMetaSource
}): React.JSX.Element {
  const copy = androidCopy(locale)
  return (
    <section
      style={CARD_STYLES.card}
      data-tool={toolName}
      data-state={dataState}
      data-android-card-kind="compact"
      {...(metaSource === undefined ? {} : { 'data-android-meta-source': metaSource })}
    >
      <div style={CARD_STYLES.head}>
        <span style={CARD_STYLES.title}>{title}</span>
        {actionLabel !== undefined && actionLabel !== '' ? (
          <span style={CARD_STYLES.action} data-android-card-action={actionId ?? 'action'}>{actionLabel}</span>
        ) : null}
        {deviceLabel !== undefined && deviceLabel !== '' ? (
          <span style={CARD_STYLES.headDevice}>{deviceLabel}</span>
        ) : null}
        {badge}
        {openable ? (
          <span style={CARD_STYLES.openInPanel} aria-hidden="true">
            <span aria-hidden="true">⤢</span>
            {copy.openInPanel}
          </span>
        ) : null}
      </div>
      {children !== undefined ? <div style={CARD_STYLES.body}>{children}</div> : null}
    </section>
  )
}

/** Compact device label: the human name, falling back to the serial. */
export function androidCardDeviceLabelOf(device: { serial?: string; name?: string } | undefined): string {
  if (device?.name !== undefined && device.name !== '') return device.name
  if (device?.serial !== undefined && device.serial !== '') return device.serial
  return ''
}

/**
 * Conversation card for `android_boot`. Running → "starting" state; settled
 * with the `android-stream` meta → the compact live summary; anything else →
 * a defensive fallback that never throws.
 */
export function AndroidStreamCard(props: ToolCallViewProps & AndroidCardOptions): React.JSX.Element {
  const { block, toolName, callId, sessionId, autoOpen } = props
  const copy = androidCopy(props.locale)
  const locale: AndroidLocale = props.locale === 'zh' ? 'zh' : 'en'
  const settled = 'kind' in block
  const running = !settled
  const error = settled && block.isError
  const resolved = settled && !error ? resolveAndroidMeta(toolName, block) : undefined
  const streamMeta = resolved?.meta.kind === 'android-stream' ? resolved.meta : undefined
  const metaSource = streamMeta === undefined || resolved?.source !== 'hydrated' ? undefined : 'hydrated'
  const text = androidResultTextOf(block)
  const panelSource = useMemo<AndroidPanelSource | undefined>(() => streamMeta === undefined ? undefined : ({
    sessionId: String(sessionId ?? ''),
    callId,
    toolName,
    block,
  }), [block, callId, sessionId, streamMeta, toolName])
  useAndroidPanelSource(streamMeta !== undefined, panelSource)

  // Auto-open on settle: arm while the boot runs, forget on error, and take
  // the key exactly once when the live stream meta lands. The panel host's
  // openIfIdle keeps an already-open panel from being replaced.
  const autoOpenSessionId = String(sessionId ?? '')
  const autoOpenKey = androidPanelAutoOpenKey(autoOpenSessionId, callId)
  const autoOpenBlockTime = typeof block.time === 'number' && Number.isFinite(block.time) ? block.time : 0
  useEffect(() => {
    if (running && autoOpenBlockTime >= androidPanelAutoOpenActivatedAt) {
      rememberAndroidPanelAutoOpenCall(autoOpenKey)
    } else if (error) {
      forgetAndroidPanelAutoOpenCall(autoOpenKey)
    }
  }, [autoOpenBlockTime, autoOpenKey, error, running])
  useEffect(() => {
    // The pure decision gates error/tool/session/time; the running and
    // source/callback-presence guards stay here (the decision has no settled
    // field). One-shot take runs last so a re-render never reopens.
    if (running || panelSource === undefined || autoOpen === undefined) return
    if (!androidPanelAutoOpenShouldOpen({
      toolName,
      isError: error,
      blockTime: autoOpenBlockTime,
      sessionId: autoOpenSessionId,
      activatedAt: androidPanelAutoOpenActivatedAt,
      currentSessionId: autoOpenSessionId,
    })) return
    if (!takeAndroidPanelAutoOpenCall(autoOpenKey)) return
    autoOpen(panelSource)
  }, [autoOpen, autoOpenBlockTime, autoOpenKey, autoOpenSessionId, error, panelSource, running, toolName])

  if (!settled) {
    return androidCardChrome({
      title: copy.android,
      actionLabel: copy.actionBoot,
      actionId: 'boot',
      dataState: 'running',
      toolName,
      locale,
      openable: false,
      badge: <span style={{ ...CARD_STYLES.badge, ...CARD_STYLES.badgeRunning }}>{copy.booting}</span>,
      children: <div style={CARD_STYLES.loading} role="status"><span style={CARD_STYLES.muted}>{copy.booting}</span></div>,
    })
  }
  if (error) {
    return androidCardChrome({
      title: copy.android,
      actionLabel: copy.actionBoot,
      actionId: 'boot',
      dataState: 'error',
      toolName,
      locale,
      openable: false,
      badge: <span style={{ ...CARD_STYLES.badge, ...CARD_STYLES.badgeError }}>{copy.unavailable}</span>,
      children: <p style={CARD_STYLES.muted}>{text ?? copy.toolFailed}</p>,
    })
  }
  if (streamMeta === undefined) {
    return androidCardChrome({
      title: copy.android,
      actionLabel: copy.actionBoot,
      actionId: 'boot',
      dataState: 'fallback',
      toolName,
      locale,
      openable: false,
      badge: <span style={{ ...CARD_STYLES.badge, ...CARD_STYLES.badgeError }}>{copy.unavailable}</span>,
      children: (
        <>
          <p style={CARD_STYLES.muted}>{copy.noPreview}</p>
          {text !== null ? <pre style={{ ...CARD_STYLES.pre, marginTop: 8 }}>{text}</pre> : null}
        </>
      ),
    })
  }
  return androidCardChrome({
    title: copy.android,
    actionLabel: copy.actionBoot,
    actionId: 'boot',
    deviceLabel: androidCardDeviceLabelOf(streamMeta.device),
    dataState: 'live',
    toolName,
    locale,
    openable: true,
    metaSource,
    badge: <span style={{ ...CARD_STYLES.badge, ...CARD_STYLES.badgeOk }}>{copy.live}</span>,
  })
}
