import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import type { Narration } from "@/db/schema";
import { sampleScriptBody } from "@/lib/scripts/fixture";

import {
  pickTakes,
  pickVisual,
  scriptBlocks,
  scriptOwnerRef,
  sectionSceneRef,
} from "./script-blocks";

const script = { id: 12, brandId: "guide", status: "draft", body: sampleScriptBody() };

test("blocks: hook, sections as s01…, cta — with spoken text, on-screen text and their shots", () => {
  const blocks = scriptBlocks(script);
  assert.deepEqual(
    blocks.map((b) => b.sceneRef),
    ["hook", "s01", "cta"],
  );
  assert.equal(blocks[0].spokenText, "Everyone still says ninety days. That changed.");
  assert.deepEqual(blocks[0].onScreenText, ["90 → 45"]);
  assert.deepEqual(
    blocks[0].shots.map((s) => s.number),
    [1],
  );
  assert.deepEqual(
    blocks[1].shots.map((s) => s.number),
    [2],
  );
  assert.equal(blocks[1].label, "The real timeline");
  // A CTA with no on-screen text falls back to the title for its card.
  assert.deepEqual(blocks[2].onScreenText, ["Paraguay residency in 45 days"]);
  assert.equal(sectionSceneRef(9), "s10");
  assert.equal(scriptOwnerRef(12), "script:12");
});

test("blocks with nothing to say are left out", () => {
  const body = sampleScriptBody();
  body.cta.spokenLines = [];
  assert.deepEqual(
    scriptBlocks({ ...script, body }).map((b) => b.sceneRef),
    ["hook", "s01"],
  );
});

function take(over: Partial<Narration>): Narration {
  return {
    id: 1,
    ownerKind: "script",
    ownerRef: "script:12",
    sceneRef: "hook",
    language: "es-PY",
    voiceProfileId: 1,
    speaker: null,
    inputText: "x",
    spokenText: null,
    textHash: "0".repeat(64),
    provider: "manual",
    status: "done",
    masterAssetId: 1,
    playbackAssetId: null,
    durationMs: 1000,
    alignment: null,
    costUsd: 0,
    costCredits: null,
    higgsfieldJobId: null,
    externalRef: null,
    selected: true,
    reviewStatus: "approved",
    reviewNote: null,
    reviewedBy: null,
    error: null,
    createdAt: new Date(),
    ...over,
  };
}

test("pickTakes: selected and done only, narrator before a character line", () => {
  const takes = pickTakes([
    take({ id: 1, sceneRef: "hook", speaker: "tito" }),
    take({ id: 2, sceneRef: "hook", speaker: null }),
    take({ id: 3, sceneRef: "s01", status: "failed" }),
    take({ id: 4, sceneRef: "cta", selected: false }),
  ]);
  assert.equal(takes.get("hook")?.id, 2);
  assert.equal(takes.has("s01"), false);
  assert.equal(takes.has("cta"), false);
});

test("pickVisual: the shot's video before its still, matched by number, else null", () => {
  const [hook, section] = scriptBlocks(script);
  const dir = path.join("/media", "12");
  const files = [
    "01-calendar-pages-flipping.png",
    "01-old-name.mp4",
    "02-stopwatch.png",
    "manifest.json",
  ];
  assert.deepEqual(pickVisual(dir, hook.shots, files), {
    file: path.join(dir, "01-old-name.mp4"),
    kind: "video",
  });
  assert.deepEqual(pickVisual(dir, section.shots, files), {
    file: path.join(dir, "02-stopwatch.png"),
    kind: "image",
  });
  assert.equal(pickVisual(dir, section.shots, ["manifest.json"]), null);
  assert.equal(pickVisual(dir, [], files), null);
});
