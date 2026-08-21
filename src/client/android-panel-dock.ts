/**
 * Self-contained DSH layout push used by the dsh-android device panel host.
 *
 * Mirrors dsh-openpencil's `claimEditorWorkbenchDock` exactly: DSH's root is
 * an auto-width block, so a right margin shrinks its AppFrame grid instead of
 * covering the conversation. Ownership is recorded through a dedicated data
 * attribute and the exact inline-style values are restored on release, which
 * keeps this compatible with HMR and fail-closed around another plugin that
 * already owns the root margin (including openpencil's own workbench dock).
 */

export const ANDROID_PANEL_DOCK_ATTRIBUTE = 'dshAndroidPanelDockOwner'

export interface AndroidPanelDockLease {
  update: (width: number) => void
  release: () => void
  /**
   * Horizontal px another plugin's sidebar already occupies at the right
   * edge (its pre-existing root margin). The panel surface positions at
   * `right: offset` so both columns coexist instead of fighting (#2).
   */
  readonly offset: number
}

function dockWidth(width: number): string {
  return `${Math.max(0, Math.round(width))}px`
}

/**
 * How much of the viewport a foreign sidebar may occupy before stacking
 * beside it stops making sense and the overlay fallback takes over.
 */
export const ANDROID_DOCK_MAX_FOREIGN_FRACTION = 0.6

/**
 * Reserve real layout space for the fixed right-hand device panel.
 *
 * A pre-existing root margin used to fail the claim outright, which turned
 * every third-party sidebar (dsh-better-sidebar was the report, #2) into a
 * modal-overlay experience. A foreign margin is now COEXISTED with instead:
 * the lease treats it as a fixed right-edge offset, reserves
 * `offset + width` through the root margin, and the surface docks at
 * `right: offset` — the device panel sits immediately left of the other
 * sidebar. The offset is a claim-time snapshot; a foreign sidebar that
 * resizes itself afterwards is out of scope for this lease (close/reopen
 * the panel to re-measure).
 *
 * @param root - the app root element (`#root`) the panel pushes over.
 * @param owner - stable lease owner id; a different owner of OUR attribute
 *   makes the claim fail (the surface falls back to its overlay variant).
 * @param initialWidth - panel width in px reserved through the root margin.
 * @param computedMarginRight - current computed margin-right (0 = unclaimed).
 * @param viewportWidth - used to refuse coexistence when the foreign sidebar
 *   already occupies most of the screen.
 * @returns the lease, or undefined when the claim cannot be satisfied.
 */
export function claimAndroidPanelDock(
  root: HTMLElement,
  owner: string,
  initialWidth: number,
  computedMarginRight = 0,
  viewportWidth = Number.POSITIVE_INFINITY,
): AndroidPanelDockLease | undefined {
  const existingOwner = root.dataset[ANDROID_PANEL_DOCK_ATTRIBUTE]
  if (existingOwner !== undefined && existingOwner !== owner) return undefined
  const foreign = existingOwner === undefined && Number.isFinite(computedMarginRight) && computedMarginRight > 0.5
    ? Math.round(computedMarginRight)
    : 0
  if (foreign > viewportWidth * ANDROID_DOCK_MAX_FOREIGN_FRACTION) return undefined

  const previousMarginRight = root.style.marginRight
  const previousMinWidth = root.style.minWidth
  root.dataset[ANDROID_PANEL_DOCK_ATTRIBUTE] = owner
  root.style.minWidth = '0'

  let released = false
  const update = (width: number): void => {
    if (released || root.dataset[ANDROID_PANEL_DOCK_ATTRIBUTE] !== owner) return
    root.style.marginRight = dockWidth(foreign + Math.max(0, Math.round(width)))
  }
  const release = (): void => {
    if (released) return
    released = true
    if (root.dataset[ANDROID_PANEL_DOCK_ATTRIBUTE] !== owner) return
    root.style.marginRight = previousMarginRight
    root.style.minWidth = previousMinWidth
    delete root.dataset[ANDROID_PANEL_DOCK_ATTRIBUTE]
  }

  update(initialWidth)
  return { update, release, offset: foreign }
}
