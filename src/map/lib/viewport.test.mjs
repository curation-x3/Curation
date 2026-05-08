// Run: npm exec --yes tsx --test src/map/lib/viewport.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  applyZoomAt,
  clampViewport,
  normalizeWheelDelta,
  panViewportBy,
  viewportContentPoint,
} = await import("./viewport.ts");

test("zoom keeps the anchored content point under the pointer", () => {
  const before = { scale: 1, x: 0, y: 0 };
  const anchor = { x: 640, y: 360 };
  const stage = { width: 1280, height: 720 };
  const contentBefore = viewportContentPoint(before, anchor);

  const after = applyZoomAt(before, 1.8, anchor, stage);
  const contentAfter = viewportContentPoint(after, anchor);

  assert.equal(after.scale, 1.8);
  assert.equal(contentAfter.x, contentBefore.x);
  assert.equal(contentAfter.y, contentBefore.y);
});

test("zoom clamps scale and translation to the visible stage", () => {
  const stage = { width: 1000, height: 700 };
  const tooLarge = applyZoomAt(
    { scale: 3, x: -1500, y: -1200 },
    10,
    { x: 900, y: 650 },
    stage,
  );
  assert.equal(tooLarge.scale, 3.25);
  assert.ok(tooLarge.x <= 0);
  assert.ok(tooLarge.x >= stage.width * (1 - tooLarge.scale));
  assert.ok(tooLarge.y <= 0);
  assert.ok(tooLarge.y >= stage.height * (1 - tooLarge.scale));

  const reset = clampViewport({ scale: 0.2, x: -300, y: -200 }, stage);
  assert.deepEqual(reset, { scale: 1, x: 0, y: 0 });
});

test("wheel deltas normalize line and page units", () => {
  assert.equal(normalizeWheelDelta({ deltaY: 2, deltaMode: 0 }), 2);
  assert.equal(normalizeWheelDelta({ deltaY: 2, deltaMode: 1 }), 32);
  assert.equal(normalizeWheelDelta({ deltaY: 2, deltaMode: 2 }), 1600);
});

test("panning is clamped inside the zoomed stage", () => {
  const stage = { width: 1200, height: 800 };
  const viewport = { scale: 2, x: -300, y: -250 };

  assert.deepEqual(panViewportBy(viewport, { x: 100, y: 80 }, stage), {
    scale: 2,
    x: -200,
    y: -170,
  });

  assert.deepEqual(panViewportBy(viewport, { x: 2000, y: 2000 }, stage), {
    scale: 2,
    x: 0,
    y: 0,
  });

  assert.deepEqual(panViewportBy(viewport, { x: -2000, y: -2000 }, stage), {
    scale: 2,
    x: -1200,
    y: -800,
  });
});
