export interface PaneLayout {
  topHeight?: number;
  rightWidth?: number;
}

export interface PaneDefaults {
  topHeight: number;
  rightWidth: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function clampTopHeight(value: number, windowHeight: number): number {
  return Math.max(100, Math.min(value, windowHeight - 150));
}

export function clampRightWidth(value: number, windowWidth: number): number {
  return Math.max(150, Math.min(value, windowWidth / 2));
}

/**
 * Resolve the pane sizes for a request: use its saved layout when a given axis
 * is present and finite, otherwise the global default. Always clamped to the
 * current window so a layout saved on a large screen can't wedge the panes off
 * a smaller one.
 */
export function resolvePaneLayout(
  saved: PaneLayout | undefined,
  defaults: PaneDefaults,
  win: WindowSize
): PaneDefaults {
  const rawTop = isFiniteNumber(saved?.topHeight) ? (saved!.topHeight as number) : defaults.topHeight;
  const rawRight = isFiniteNumber(saved?.rightWidth) ? (saved!.rightWidth as number) : defaults.rightWidth;
  return {
    topHeight: clampTopHeight(rawTop, win.height),
    rightWidth: clampRightWidth(rawRight, win.width),
  };
}
