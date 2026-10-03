// The back order (v3 phase 00): what Escape on the web, the Android back button and a gamepad B
// do, in this order. src/main.ts builds the one `BackUi` and both Escape and `platform.onBack` call
// `goBack` with it, so the order lives here and nowhere else.

export interface BackUi {
  /** Closes the top modal (or a popover such as the seed picker); true if one was open, even one that cannot be dismissed. */
  closeModal(): boolean;
  /** Leaves Decorate, plant, build or placement mode (one step of it: Decorate first drops a held piece); true if one was on. */
  leaveMode(): boolean;
  /** Closes the open panel; true if one was open. */
  closePanel(): boolean;
  /** Hides a tap-to-inspect label (v2-05); true if one was showing. */
  clearLabel(): boolean;
}

/**
 * One step back: close an open modal, else leave a mode (or end a Paint stroke), else close the open panel, else
 * hide a tap-to-inspect label. Returns false
 * when there was nothing to go back from, so the shell can minimise the app (Android) or ask to
 * quit (desktop); the web does nothing.
 */
export function goBack(ui: BackUi): boolean {
  return ui.closeModal() || ui.leaveMode() || ui.closePanel() || ui.clearLabel();
}
