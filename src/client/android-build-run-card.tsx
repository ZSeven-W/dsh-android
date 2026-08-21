/**
 * Build & run card (`android_build_run`).
 *
 * The device display lives in the persistent right-side panel, so the card
 * renders the shared compact summary (tool title, device name, 完成 badge,
 * "open in sidebar" affordance) with a slim meta line carrying the launched
 * package name and the open-APK link; the panel's stream mode renders the
 * live view for the device. Running calls show a building state; errors and
 * meta-less results fall back to the defensive plain card. Settled results
 * register as openable panel sources.
 */

import { useMemo } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { resolveAndroidMeta } from './android-meta-hydrate.js'
import { androidCopy } from './copy.js'
import { androidResultTextOf } from './android-result.js'
import { CARD_STYLES } from './card-styles.js'
import {
  androidCardChrome,
  androidCardDeviceLabelOf,
  type AndroidCardOptions,
} from './android-stream-card.js'
import { useAndroidPanelSource, type AndroidPanelSource } from './android-panel-trigger.js'

export function AndroidBuildRunCard(props: ToolCallViewProps & AndroidCardOptions): React.JSX.Element {
  const { block, toolName, openFile, callId, sessionId } = props
  const copy = androidCopy(props.locale)
  const locale = props.locale === 'zh' ? 'zh' : 'en'
  const settled = 'kind' in block
  const error = settled && block.isError
  const resolved = settled && !error ? resolveAndroidMeta(toolName, block) : undefined
  const buildMeta = resolved?.meta.kind === 'android-build-run' ? resolved.meta : undefined
  const metaSource = buildMeta === undefined || resolved?.source !== 'hydrated' ? undefined : 'hydrated'
  const text = androidResultTextOf(block)
  const panelSource = useMemo<AndroidPanelSource | undefined>(() => buildMeta === undefined ? undefined : ({
    sessionId: String(sessionId ?? ''),
    callId,
    toolName,
    block,
  }), [block, callId, sessionId, buildMeta, toolName])
  useAndroidPanelSource(buildMeta !== undefined, panelSource)

  if (!settled) {
    return androidCardChrome({
      title: copy.android,
      actionLabel: copy.actionBuildRun,
      actionId: 'build-run',
      dataState: 'running',
      toolName,
      locale,
      openable: false,
      badge: <span style={{ ...CARD_STYLES.badge, ...CARD_STYLES.badgeRunning }}>{copy.building}</span>,
      children: <div style={CARD_STYLES.loading} role="status"><span style={CARD_STYLES.muted}>{copy.building}</span></div>,
    })
  }
  if (error) {
    return androidCardChrome({
      title: copy.android,
      actionLabel: copy.actionBuildRun,
      actionId: 'build-run',
      dataState: 'error',
      toolName,
      locale,
      openable: false,
      badge: <span style={{ ...CARD_STYLES.badge, ...CARD_STYLES.badgeError }}>{copy.unavailable}</span>,
      children: <p style={CARD_STYLES.muted}>{text ?? copy.toolFailed}</p>,
    })
  }
  if (buildMeta === undefined) {
    return androidCardChrome({
      title: copy.android,
      actionLabel: copy.actionBuildRun,
      actionId: 'build-run',
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
  const hasMeta = buildMeta.packageName !== undefined
    || (buildMeta.apkPath !== undefined && openFile !== undefined)
  return androidCardChrome({
    title: copy.android,
    actionLabel: copy.actionBuildRun,
    actionId: 'build-run',
    deviceLabel: androidCardDeviceLabelOf(buildMeta.device),
    dataState: 'live',
    toolName,
    locale,
    openable: true,
    metaSource,
    badge: <span style={{ ...CARD_STYLES.badge, ...CARD_STYLES.badgeOk }}>{copy.done}</span>,
    children: hasMeta ? (
      <>
        {buildMeta.packageName !== undefined ? (
          <div style={CARD_STYLES.keyValue}>
            <span style={CARD_STYLES.key}>{copy.packageName}</span>
            <span style={CARD_STYLES.value}>{buildMeta.packageName}</span>
          </div>
        ) : null}
        {buildMeta.apkPath !== undefined && openFile !== undefined ? (
          <div>
            <button type="button" style={CARD_STYLES.button} onClick={() => { openFile(buildMeta.apkPath ?? '') }}>
              {copy.openApk}
            </button>
          </div>
        ) : null}
      </>
    ) : undefined,
  })
}
