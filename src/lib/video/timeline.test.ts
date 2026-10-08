import assert from "node:assert/strict";
import { test } from "node:test";

import type { RenderScene } from "./contract";
import { DEFAULT_PAD_AFTER_MS, FORMAT_SIZE, planTimeline } from "./timeline";

function scene(ref: string, audioMs: number, pad?: number, audio = true): RenderScene {
  return {
    sceneRef: ref,
    visualPath: "/x.png",
    visualKind: "image",
    audioPath: audio ? "/a.wav" : null,
    audioDurationMs: audioMs,
    padAfterMs: pad,
    captionText: "",
  };
}

test("scene length is measured audio plus padding, default 600 ms, never stretched", () => {
  const tl = planTimeline([scene("S01", 2300), scene("S02", 1500, 900)]);
  assert.equal(DEFAULT_PAD_AFTER_MS, 600);
  assert.deepEqual(
    tl.scenes.map((s) => [s.sceneRef, s.startMs, s.endMs, s.audioMs, s.padMs]),
    [
      ["S01", 0, 2900, 2300, 600],
      ["S02", 2900, 5300, 1500, 900],
    ],
  );
  assert.equal(tl.totalMs, 5300);
});

test("frames come from cumulative times, so they add up to the total", () => {
  const scenes = Array.from({ length: 7 }, (_, i) => scene(`S${i}`, 1017 + i * 13, 0));
  const tl = planTimeline(scenes);
  assert.equal(tl.totalFrames, Math.round((tl.totalMs * 30) / 1000));
  assert.equal(
    tl.scenes.reduce((sum, s) => sum + s.frames, 0),
    tl.totalFrames,
  );
  tl.scenes.forEach((s, i) => {
    if (i > 0) assert.equal(s.startFrame, tl.scenes[i - 1].startFrame + tl.scenes[i - 1].frames);
  });
});

test("a scene without audio is its padding; one with neither still lasts a second", () => {
  const tl = planTimeline([scene("S01", 4000, 700, false), scene("S02", 0, 0, false)]);
  assert.equal(tl.scenes[0].audioMs, 0);
  assert.equal(tl.scenes[0].durationMs, 700);
  assert.equal(tl.scenes[1].durationMs, 1000);
});

test("bad numbers fall back instead of producing NaN", () => {
  const tl = planTimeline([scene("S01", Number.NaN, -5)]);
  assert.equal(tl.totalMs, 600);
});

test("format sizes", () => {
  assert.deepEqual(FORMAT_SIZE["16x9"], { width: 1920, height: 1080 });
  assert.deepEqual(FORMAT_SIZE["9x16"], { width: 1080, height: 1920 });
  assert.deepEqual(FORMAT_SIZE["1x1"], { width: 1080, height: 1080 });
});
