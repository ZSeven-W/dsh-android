/**
 * Screenshot card (`android_screenshot` and `android_interact`).
 *
 * The device display lives in the persistent right-side panel, so the card
 * never grants/renders the PNG inline: it renders the shared compact one-line
 * summary (tool title, device name, 完成 badge, "open in sidebar" affordance)
 * plus the durable caption's byte size/dimensions and the 打开截图 link.
 * Clicking the row opens the panel via the row-click trigger; settled
 * meta-carrying results register as openable sources for the panel.
 */

import { useMemo } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { ANDROID_CARD_TOOLS, type AndroidScreenshotMeta } from './protocol.js'
import { resolveAndroidMeta } from './android-meta-hydrate.js'
import { androidCopy, formatBytes } from './copy.js'
import { androidResultSummaryOf, androidResultTextOf } from './android-result.js'
import { CARD_STYLES } from './card-styles.js'
import {
  androidCardChrome,
  androidCardDeviceLabelOf,
  type AndroidCardOptions,
} from './android-stream-card.js'
import { useAndroidPanelSource, type AndroidPanelSource } from './android-panel-trigger.js'

/** Compact caption: byte size + pixel dimensions (the head carries the device). */
function screenshotCaption(
  bytes: number | undefined,
  width: number | undefined,
  height: number | undefined,
): React.ReactNode {
  const parts: React.ReactNode[] = []
  const size = formatBytes(bytes)
  if (size !== undefined) parts.push(size)
  if (width !== undefined && height !== undefined) parts.push(`${width}×${height}`)
  if (parts.length === 0) return null
  return parts.map((part, index) => (
    <span key={index}>{part}</span>
  ))
}

/**
 * Conversation card for `android_screenshot` / `android_interact`. Compact
 * summary row with the openFile (打开截图) link; never renders an `<img>` and
 * never throws.
 */
export function AndroidScreenshotCard(props: ToolCallViewProps & AndroidCardOptions): React.JSX.Element {
  const { block, toolName, openFile, callId, sessionId } = props
  const copy = androidCopy(props.locale)
  const locale = props.locale === 'zh' ? 'zh' : 'en'
  const isInteract = toolName === ANDROID_CARD_TOOLS.interact
  // The unified title is always "Android 设备" / "Android"; the action
  // sub-label (截图/交互) keeps the card distinguishable.
  const actionLabel = isInteract ? copy.actionInteract : copy.actionScreenshot
  const actionId = isInteract ? 'interact' : 'screenshot'
  const settled = 'kind' in block
  const error = settled && block.isError
  const resolved = settled && !error ? resolveAndroidMeta(toolName, block) : undefined
  const screenshotMeta: AndroidScreenshotMeta | undefined = resolved?.meta.kind === 'android-screenshot'
    ? resolved.meta
    : undefined
  const metaSource = screenshotMeta === undefined || resolved?.source !== 'hydrated' ? undefined : 'hydrated'
  const summary = androidResultSummaryOf(block)
  const text = androidResultTextOf(block)
  const panelSource = useMemo<AndroidPanelSource | undefined>(() => screenshotMeta === undefined ? undefined : ({
    sessionId: String(sessionId ?? ''),
    callId,
    toolName,
    block,
  }), [block, callId, sessionId, screenshotMeta, toolName])
  useAndroidPanelSource(screenshotMeta !== undefined, panelSource)

  if (!settled) {
    return androidCardChrome({
      title: copy.android,
      actionLabel,
      actionId,
      dataState: 'running',
      toolName,
      locale,
      openable: false,
      badge: <span style={{ ...CARD_STYLES.badge, ...CARD_STYLES.badgeRunning }}>{copy.done}</span>,
      children: (
        <div style={CARD_STYLES.loading} role="status">
          <span style={CARD_STYLES.muted}>{isInteract ? copy.interacting : copy.captureScreenshot}</span>
        </div>
      ),
    })
  }
  if (error) {
    return androidCardChrome({
      title: copy.android,
      actionLabel,
      actionId,
      dataState: 'error',
      toolName,
      locale,
      openable: false,
      badge: <span style={{ ...CARD_STYLES.badge, ...CARD_STYLES.badgeError }}>{copy.unavailable}</span>,
      children: <p style={CARD_STYLES.muted}>{text ?? copy.toolFailed}</p>,
    })
  }
  if (screenshotMeta === undefined) {
    return androidCardChrome({
      title: copy.android,
      actionLabel,
      actionId,
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
  const caption = screenshotCaption(summary?.bytes, summary?.width, summary?.height)
  return androidCardChrome({
    title: copy.android,
    actionLabel,
    actionId,
    deviceLabel: androidCardDeviceLabelOf(screenshotMeta.device),
    dataState: 'live',
    toolName,
    locale,
    openable: true,
    metaSource,
    badge: <span style={{ ...CARD_STYLES.badge, ...CARD_STYLES.badgeOk }}>{copy.done}</span>,
    children: caption !== null || openFile !== undefined ? (
      <div style={CARD_STYLES.meta}>
        {caption}
        {openFile !== undefined ? (
          <button type="button" style={CARD_STYLES.button} onClick={() => { openFile(screenshotMeta.path) }}>
            {copy.openScreenshot}
          </button>
        ) : null}
      </div>
    ) : undefined,
  })
}
