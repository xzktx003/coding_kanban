interface ViewportHeightMeasurements {
  innerHeight?: number | null;
  visualViewportHeight?: number | null;
  documentElementClientHeight?: number | null;
  fullscreenElementClientHeight?: number | null;
  screenAvailHeight?: number | null;
}

function normalizeViewportHeight(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}

export function resolveAppViewportOffsetTop(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.round(value);
}

export function resolveAppViewportHeight({
  innerHeight,
  visualViewportHeight,
  documentElementClientHeight,
  fullscreenElementClientHeight,
  screenAvailHeight,
}: ViewportHeightMeasurements) {
  const layoutViewportHeight =
    normalizeViewportHeight(fullscreenElementClientHeight) ??
    normalizeViewportHeight(documentElementClientHeight);
  const visibleViewportHeight =
    normalizeViewportHeight(visualViewportHeight) ??
    normalizeViewportHeight(innerHeight);
  const workAreaHeight = normalizeViewportHeight(screenAvailHeight);

  const resolvedHeight =
    layoutViewportHeight && visibleViewportHeight
      ? Math.min(
          layoutViewportHeight,
          visibleViewportHeight,
          workAreaHeight ?? Number.POSITIVE_INFINITY,
        )
      : (layoutViewportHeight ?? visibleViewportHeight ?? workAreaHeight ?? 0);

  return Math.round(resolvedHeight);
}

export function measureAppViewportHeight(win = window, doc = document) {
  const fullscreenElement = doc.fullscreenElement;
  const fullscreenElementClientHeight =
    fullscreenElement instanceof HTMLElement
      ? fullscreenElement.clientHeight
      : null;

  return resolveAppViewportHeight({
    innerHeight: win.innerHeight,
    visualViewportHeight: win.visualViewport?.height,
    documentElementClientHeight: doc.documentElement?.clientHeight,
    fullscreenElementClientHeight,
    screenAvailHeight: win.screen?.availHeight,
  });
}

export function measureAppViewportOffsetTop(win = window) {
  return resolveAppViewportOffsetTop(win.visualViewport?.offsetTop);
}
