/**
 * Compatibility boundary for the tool details surface on DSH 0.1.5.
 *
 * 0.1.5 removed the rc.8 single-occupant `conversation.details.tool` seat
 * (and with it `DetailsToolOwnerProps`); there is no keyed per-tool
 * details seat at all. The tool layer's details renderer now dispatches the
 * SELECTED call through the same keyed `tool.call.toolview` seat the
 * conversation rows render, so what a tool details view receives on 0.1.5 is
 * exactly the tool-view owner currency: `callId`, `toolName`, the frozen
 * running-or-settled `ToolCallBlock`, `openFile`/`loadImage`/`inspect`,
 * plus the framework-resolved session standard kit (`sessionId`).
 *
 * This module aliases that contract so the panel keeps one props vocabulary;
 * the plugin's own page-owned panel host (android-panel-host) carries the
 * live device surface regardless.
 * @module @zseven-w/dsh-android/client/details-compat
 */

import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'

/** Details props a selected-call tool details view receives on DSH 0.1.5. */
export type CompatibleToolDetailsViewProps = ToolCallViewProps
