import assert from "node:assert/strict";
import { test } from "node:test";

import { sampleScriptBody } from "@/lib/scripts/fixture";
import { sceneReadiness, type SceneLike } from "@/lib/stories/readiness";
import { scriptBlocks } from "@/lib/video/script-blocks";

import {
  buildScriptLines,
  buildStoryLines,
  parseSourceKey,
  recordVoiceLanguage,
  sourceKey,
} from "./lines";

const scenes: SceneLike[] = [
  {
    sceneRef: "S01",
    text: { es: "Tito salta.", gn: "Tito opopo." },
    textStatus: { es: "approved", gn: "approved" },
    lines: {},
  },
  {
    sceneRef: "S02",
    text: { es: "—¡Hola! —dijo Tito. Meli sonrió.", gn: "Tito he'i." },
    textStatus: { es: "approved-in-app", gn: "human-review-pending" },
    lines: {
      es: [
        { speaker: "tito", text: "—¡Hola! —dijo Tito." },
        { speaker: null, text: "Meli sonrió." },
      ],
    },
  },
  {
    sceneRef: "S03",
    text: { es: "Todo el día jugaron. PENDIENTE", gn: null },
    textStatus: { es: "approved" },
    lines: {},
  },
  {
    sceneRef: "S04",
    text: { es: "Fin.", gn: "Paha." },
    textStatus: { es: "draft-for-author", gn: "approved" },
    lines: {},
  },
];

test("story lines: every slot in order, approved text unlocked, the rest locked with a reason", () => {
  const lines = buildStoryLines("tito", scenes, "es");
  assert.deepEqual(
    lines.map((l) => [l.slot, l.locked?.reason ?? null]),
    [
      ["S01", null],
      ["S02#1", null],
      ["S02#2", null],
      ["S03", "pending_notice"],
      ["S04", "not_approved"],
    ],
  );
  assert.deepEqual(
    lines.map((l) => l.index),
    [0, 1, 2, 3, 4],
  );
  const s02 = lines[1];
  assert.equal(s02.ownerKind, "story_scene");
  assert.equal(s02.ownerRef, "story:tito");
  assert.equal(s02.speaker, "tito");
  assert.equal(s02.text, "—¡Hola! —dijo Tito.");
  assert.equal(s02.baseRef, "S02");
  assert.equal(s02.label, "S02 · 1/2");
  assert.match(lines[4].locked!.message, /draft-for-author/);
});

test("story lines: Guaraní needs approved Guaraní text too; missing text is never filled", () => {
  const lines = buildStoryLines("tito", scenes, "gn");
  assert.deepEqual(
    lines.map((l) => [l.slot, l.locked?.reason ?? null, l.text]),
    [
      ["S01", null, "Tito opopo."],
      ["S02", "not_approved", "Tito he'i."],
      ["S03", "missing_text", ""],
      ["S04", null, "Paha."],
    ],
  );
});

test("story lines: slots are the ones the stories studio reads (sceneReadiness)", () => {
  for (const lang of ["es", "gn"]) {
    const ours = buildStoryLines("tito", scenes, lang)
      .filter((l) => l.text)
      .map((l) => [l.slot, l.speaker, l.text]);
    const studio = scenes.flatMap((s) =>
      sceneReadiness(s, lang, []).lines.map((l) => [l.slot, l.line.speaker ?? null, l.line.text]),
    );
    assert.deepEqual(ours, studio);
  }
});

test("script lines: the spoken blocks with the video studio's refs; a review notice locks", () => {
  const body = sampleScriptBody();
  const blocks = scriptBlocks({ id: 7, brandId: "guide", status: "draft", body });
  const lines = buildScriptLines(7, blocks);
  assert.deepEqual(
    lines.map((l) => l.slot),
    ["hook", "s01", "cta"],
  );
  assert.ok(lines.every((l) => l.ownerKind === "script" && l.ownerRef === "script:7"));
  assert.ok(lines.every((l) => l.locked === null && l.speaker === null));
  assert.equal(lines[0].text, blocks[0].spokenText);

  const locked = buildScriptLines(7, [
    { sceneRef: "hook", label: "Hook", spokenText: "Esto es todo." },
    { sceneRef: "s01", label: "Uno", spokenText: "Precio TODO confirmar." },
  ]);
  assert.equal(locked[0].locked, null, "lower-case “todo” is Spanish, not a notice");
  assert.equal(locked[1].locked?.reason, "pending_notice");
});

test("source keys round-trip; junk is refused; voice language per source", () => {
  const story = { kind: "story", slug: "tito-salto", lang: "gn" } as const;
  assert.equal(sourceKey(story), "story:tito-salto:gn");
  assert.deepEqual(parseSourceKey("story:tito-salto:gn"), story);
  assert.deepEqual(parseSourceKey("script:12"), { kind: "script", scriptId: 12 });
  assert.deepEqual(parseSourceKey("story:x:jopara"), { kind: "story", slug: "x", lang: "jopara" });
  for (const bad of ["", "story:../x:es", "story:x", "script:0", "script:abc", "other:1"]) {
    assert.equal(parseSourceKey(bad), null, bad);
  }
  assert.equal(recordVoiceLanguage(story), "gn");
  assert.equal(recordVoiceLanguage({ kind: "story", slug: "x", lang: "es" }), "es-PY");
  assert.equal(recordVoiceLanguage({ kind: "script", scriptId: 1 }, "es-PY"), "es-PY");
  assert.equal(recordVoiceLanguage({ kind: "script", scriptId: 1 }, "jopara"), "jopara");
  assert.equal(recordVoiceLanguage({ kind: "script", scriptId: 1 }, "xx"), null);
});
