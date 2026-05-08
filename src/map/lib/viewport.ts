export type ViewportTransform = {
  scale: number;
  x: number;
  y: number;
};

export type ViewportSize = {
  width: number;
  height: number;
};

export type ViewportPoint = {
  x: number;
  y: number;
};

export const MAP_VIEWPORT_MIN_SCALE = 1;
export const MAP_VIEWPORT_MAX_SCALE = 3.25;
export const MAP_VIEWPORT_WHEEL_SENSITIVITY = 0.0016;

export const DEFAULT_VIEWPORT: ViewportTransform = {
  scale: 1,
  x: 0,
  y: 0,
};

export function normalizeWheelDelta(event: {
  deltaY: number;
  deltaMode: number;
}): number {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * 800;
  return event.deltaY;
}

export function wheelZoomFactor(event: {
  deltaY: number;
  deltaMode: number;
}): number {
  const delta = normalizeWheelDelta(event);
  return Math.exp(-delta * MAP_VIEWPORT_WHEEL_SENSITIVITY);
}

export function viewportContentPoint(
  viewport: ViewportTransform,
  point: ViewportPoint,
): ViewportPoint {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

export function clampViewport(
  viewport: ViewportTransform,
  stage: ViewportSize,
): ViewportTransform {
  const scale = clamp(
    viewport.scale,
    MAP_VIEWPORT_MIN_SCALE,
    MAP_VIEWPORT_MAX_SCALE,
  );

  if (scale <= MAP_VIEWPORT_MIN_SCALE || stage.width <= 0 || stage.height <= 0) {
    return DEFAULT_VIEWPORT;
  }

  return {
    scale,
    x: clamp(viewport.x, stage.width * (1 - scale), 0),
    y: clamp(viewport.y, stage.height * (1 - scale), 0),
  };
}

export function applyZoomAt(
  viewport: ViewportTransform,
  factor: number,
  anchor: ViewportPoint,
  stage: ViewportSize,
): ViewportTransform {
  const nextScale = clamp(
    viewport.scale * factor,
    MAP_VIEWPORT_MIN_SCALE,
    MAP_VIEWPORT_MAX_SCALE,
  );
  const contentPoint = viewportContentPoint(viewport, anchor);

  return clampViewport(
    {
      scale: nextScale,
      x: anchor.x - contentPoint.x * nextScale,
      y: anchor.y - contentPoint.y * nextScale,
    },
    stage,
  );
}

export function panViewportBy(
  viewport: ViewportTransform,
  delta: ViewportPoint,
  stage: ViewportSize,
): ViewportTransform {
  return clampViewport(
    {
      ...viewport,
      x: viewport.x + delta.x,
      y: viewport.y + delta.y,
    },
    stage,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
