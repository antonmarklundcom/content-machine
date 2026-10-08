import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_ROTATION,
  ease,
  FOREGROUND_FIT,
  MAX_ZOOM,
  resolveCameras,
  visibleWindow,
  zoompanExpressions,
} from "./camera";
import { CAMERA_MOVES, type CameraMove } from "./contract";

test("scenes without a move rotate, and consecutive scenes never repeat a move", () => {
  const moves = resolveCameras([{}, {}, {}, {}, {}]);
  assert.deepEqual(moves.slice(0, 4), DEFAULT_ROTATION);
  for (let i = 1; i < moves.length; i++) assert.notEqual(moves[i], moves[i - 1]);
});

test("an explicit move is kept and the rotation steps around it", () => {
  const moves = resolveCameras([{ camera: "zoom_in" }, {}, { camera: "none" }, {}]);
  assert.equal(moves[0], "zoom_in");
  assert.notEqual(moves[1], "zoom_in");
  assert.equal(moves[2], "none");
  for (let i = 1; i < moves.length; i++) assert.notEqual(moves[i], moves[i - 1]);
});

test("ease is smoothstep, clamped", () => {
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.equal(ease(0.5), 0.5);
  assert.equal(ease(2), 1);
});

test("every move is gentle (≤ 8% scale) and never crops the art", () => {
  const fgMin = (1 - FOREGROUND_FIT) / 2;
  const fgMax = 1 - fgMin;
  for (const move of CAMERA_MOVES as readonly CameraMove[]) {
    let minZoom = Infinity;
    let maxZoom = 0;
    for (let i = 0; i <= 100; i++) {
      const w = visibleWindow(move, i / 100);
      minZoom = Math.min(minZoom, w.zoom);
      maxZoom = Math.max(maxZoom, w.zoom);
      assert.ok(w.x >= 0 && w.y >= 0, `${move}: window inside the composite`);
      assert.ok(w.x + w.w <= 1 + 1e-9 && w.y + w.h <= 1 + 1e-9, `${move}: window inside`);
      assert.ok(w.x <= fgMin && w.x + w.w >= fgMax, `${move} at ${i}%: art fully visible across`);
      assert.ok(w.y <= fgMin && w.y + w.h >= fgMax, `${move} at ${i}%: art fully visible down`);
    }
    assert.ok(maxZoom / minZoom <= MAX_ZOOM + 1e-9, `${move}: ≤ 8% scale change`);
  }
});

test("zoompan expressions use the eased output frame and the same window formula", () => {
  const zin = zoompanExpressions("zoom_in", 90);
  assert.match(zin.z, /^1\+0\.08\*/);
  assert.ok(zin.z.includes("on/89"));
  assert.equal(zin.x, "iw*((1-1/zoom)/2+0)");
  const pan = zoompanExpressions("pan_right", 60);
  assert.equal(pan.z, "1.05");
  assert.ok(pan.x.includes("0.04*(") && pan.x.includes("-0.5)"));
  assert.equal(pan.y, "ih*((1-1/zoom)/2+0)");
  assert.equal(zoompanExpressions("none", 1).z, "1");
  assert.ok(zoompanExpressions("none", 1).x.length > 0);
});
