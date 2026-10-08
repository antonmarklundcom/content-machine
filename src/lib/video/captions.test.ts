import assert from "node:assert/strict";
import { test } from "node:test";

import type { WordTiming } from "@/lib/voice/contract";

import {
  cuesFromTimings,
  cuesProportional,
  escapeSrt,
  escapeVtt,
  MAX_CUE_MS,
  MAX_LINE_CHARS,
  MIN_CUE_MS,
  planCues,
  splitSentences,
  srtTimestamp,
  toSrt,
  toVtt,
  vttTimestamp,
  wrapLines,
  type Cue,
} from "./captions";
import type { RenderScene } from "./contract";
import { planTimeline } from "./timeline";

function timings(text: string, msPerWord = 300, start = 0): WordTiming[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => ({
      word,
      startMs: start + i * msPerWord,
      endMs: start + i * msPerWord + msPerWord - 40,
    }));
}

function checkShape(cues: { lines: string[]; startMs: number; endMs: number }[]) {
  for (const c of cues) {
    assert.ok(c.lines.length >= 1 && c.lines.length <= 2, `≤ 2 lines: ${JSON.stringify(c.lines)}`);
    for (const l of c.lines) assert.ok(l.length <= MAX_LINE_CHARS, `line ≤ 42: "${l}"`);
    assert.ok(c.endMs - c.startMs <= MAX_CUE_MS, "≤ 6 s");
  }
}

test("wrapLines: one line when it fits, two balanced lines, null when too long", () => {
  assert.deepEqual(wrapLines("Hola, mundo."), ["Hola, mundo."]);
  const two = wrapLines("Había una vez un sapito que vivía junto al arroyo del monte");
  assert.ok(two && two.length === 2);
  assert.ok(Math.abs(two![0].length - two![1].length) < 12, "balanced");
  assert.equal(wrapLines("palabra ".repeat(20)), null);
});

test("splitSentences keeps punctuation, including ¡…! and …", () => {
  assert.deepEqual(splitSentences("¡Hola! ¿Cómo estás? Bien… gracias"), [
    "¡Hola!",
    "¿Cómo estás?",
    "Bien…",
    "gracias",
  ]);
});

test("cues from word timings break at sentence ends and respect the limits", () => {
  const text =
    "Tito era un sapito muy chiquito. Vivía en el arroyo, cerca del monte grande donde cantan los pájaros todas las mañanas. ¡Y saltaba!";
  const cues = cuesFromTimings(text, timings(text));
  checkShape(cues);
  assert.equal(cues[0].lines.join(" "), "Tito era un sapito muy chiquito.");
  assert.equal(cues.at(-1)!.lines.join(" "), "¡Y saltaba!");
  // Every word appears once, in order.
  assert.equal(cues.flatMap((c) => c.lines.join(" ").split(" ")).join(" "), text);
});

test("cues from timings split a long unpunctuated run at 6 s", () => {
  const text = Array.from({ length: 12 }, (_, i) => `w${i}`).join(" ");
  const cues = cuesFromTimings(text, timings(text, 900));
  checkShape(cues);
  assert.ok(cues.length >= 2);
});

test("caption text punctuation is kept when the provider's words are bare", () => {
  const text = "Hola, Tito. ¿Saltamos?";
  const bare: WordTiming[] = [
    { word: "hola", startMs: 0, endMs: 300 },
    { word: "tito", startMs: 300, endMs: 700 },
    { word: "saltamos", startMs: 900, endMs: 1500 },
  ];
  const cues = cuesFromTimings(text, bare);
  assert.deepEqual(
    cues.map((c) => c.lines.join(" ")),
    ["Hola, Tito.", "¿Saltamos?"],
  );
});

test("proportional cues split by characters across the audio, at sentence boundaries", () => {
  const cues = cuesProportional("Uno dos tres. Cuatro cinco seis siete ocho nueve.", 5000);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startMs, 0);
  assert.equal(cues[1].endMs, 5000);
  const first = "Uno dos tres.".length;
  const total = first + "Cuatro cinco seis siete ocho nueve.".length;
  assert.equal(cues[0].endMs, Math.round((5000 * first) / total));
});

test("proportional cues never exceed 6 s even for one long sentence", () => {
  const text = "una frase larga sin puntos que sigue y sigue durante mucho tiempo";
  const cues = cuesProportional(text, 20_000);
  checkShape(cues);
  assert.equal(cues.at(-1)!.endMs, 20_000);
});

function scene(ref: string, audioMs: number, text: string, alignment?: WordTiming[]): RenderScene {
  return {
    sceneRef: ref,
    visualPath: "/x.png",
    visualKind: "image",
    audioPath: "/a.wav",
    audioDurationMs: audioMs,
    captionText: text,
    alignment: alignment ?? null,
  };
}

test("planCues offsets by scene start, stays inside its scene, and has no overlaps", () => {
  const scenes = [
    scene("S01", 2000, "Primera escena.", timings("Primera escena.", 500)),
    scene("S02", 3000, "Segunda escena, sin tiempos. Otra frase."),
  ];
  const tl = planTimeline(scenes);
  const cues = planCues(scenes, tl);
  assert.equal(cues[0].sceneRef, "S01");
  assert.equal(cues[0].startMs, 0);
  const s2 = cues.filter((c) => c.sceneRef === "S02");
  assert.equal(s2[0].startMs, tl.scenes[1].startMs);
  for (const c of s2) assert.ok(c.endMs <= tl.scenes[1].endMs);
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].startMs >= cues[i - 1].endMs);
});

test("planCues stretches a short cue to 0.8 s when there is room", () => {
  const scenes = [scene("S01", 300, "Sí.", [{ word: "Sí.", startMs: 0, endMs: 200 }])];
  const cues = planCues(scenes, planTimeline(scenes));
  assert.equal(cues[0].endMs - cues[0].startMs, MIN_CUE_MS);
});

test("timestamps", () => {
  assert.equal(srtTimestamp(0), "00:00:00,000");
  assert.equal(srtTimestamp(3_723_456), "01:02:03,456");
  assert.equal(vttTimestamp(61_005), "00:01:01.005");
});

test("SRT and VTT writers", () => {
  const cues: Cue[] = [
    {
      startMs: 0,
      endMs: 1500,
      lines: ["Hola <b>Tito</b> & {\\i1}amigos", "--> otra"],
      sceneRef: "S01",
    },
    { startMs: 1500, endMs: 3000, lines: ["Fin."], sceneRef: "S01" },
  ];
  const srt = toSrt(cues);
  assert.equal(
    srt,
    "1\n00:00:00,000 --> 00:00:01,500\nHola ‹b›Tito‹/b› & (\\i1)amigos\n→ otra\n\n2\n00:00:01,500 --> 00:00:03,000\nFin.\n",
  );
  const vtt = toVtt(cues);
  assert.ok(vtt.startsWith("WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500\n"));
  assert.ok(vtt.includes("Hola &lt;b&gt;Tito&lt;/b&gt; &amp; {\\i1}amigos\n--&gt; otra"));
  assert.equal(escapeSrt("a\nb"), "a b");
  assert.equal(escapeVtt("x > y"), "x &gt; y");
});
