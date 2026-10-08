import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { sceneReadiness, type TakeLike } from "./readiness";
import { buildStoryRenderRequest, cameraFor, SAMPLE_MAX_MS, type RenderSceneInput } from "./render";
import type { SceneAudio, StoryLine } from "./types";

const ROOT = path.resolve("/cuentos");
const MEDIA = path.resolve("/media");

let nextId = 1;
function take(sceneRef: string, inputText: string, extra: Partial<TakeLike> = {}): TakeLike {
  return {
    id: nextId++,
    sceneRef,
    language: "es-PY",
    speaker: null,
    selected: true,
    status: "done",
    inputText,
    reviewStatus: "unreviewed",
    durationMs: 1000,
    ...extra,
  };
}

/** A ready scene with `ms` of audio, or one missing something. */
function sceneInput(
  ref: string,
  opts: {
    ms?: number;
    status?: string;
    text?: string | null;
    takes?: boolean;
    audio?: boolean;
    art?: boolean;
    lines?: StoryLine[];
  } = {},
): RenderSceneInput {
  const text = opts.text === undefined ? `Texto de ${ref}, che.` : opts.text;
  const scene = {
    sceneRef: ref,
    text: { es: text },
    textStatus: { es: opts.status ?? "approved" },
    lines: (opts.lines ? { es: opts.lines } : {}) as Record<string, StoryLine[]>,
  };
  const lines = opts.lines ?? (text ? [{ speaker: null, text }] : []);
  const takes =
    opts.takes === false
      ? []
      : lines.map((l, i) =>
          take(lines.length > 1 ? `${ref}#${i + 1}` : ref, l.text, { speaker: l.speaker }),
        );
  const readiness = sceneReadiness(scene, "es", takes);
  const audio: SceneAudio | undefined =
    opts.audio === false || !readiness.takesReady
      ? undefined
      : {
          wavPath: `stories/tito/audio/es/${ref}.wav`,
          mp3Path: `stories/tito/audio/es/${ref}.mp3`,
          durationMs: opts.ms ?? 8000,
          alignment: [{ word: "Texto", startMs: 0, endMs: 400 }],
          takeIds: takes.map((t) => t.id),
          builtAt: "2026-10-07T00:00:00Z",
        };
  return {
    sceneRef: ref,
    kind: "page",
    text: { es: text },
    artPath: opts.art === false ? null : `books/tito/art/${ref}.png`,
    readiness,
    audio,
  };
}

const base = {
  slug: "tito",
  ageBand: "3-5",
  lang: "es",
  format: "16x9" as const,
  cuentosRoot: ROOT,
  mediaRoot: MEDIA,
};

test("a full render: absolute art and audio, measured durations, bedtime padding, varied camera, captions verbatim", () => {
  const plan = buildStoryRenderRequest({
    ...base,
    sample: false,
    scenes: [sceneInput("S01", { ms: 5000 }), sceneInput("S02", { ms: 7000 })],
  });
  assert.ok(plan.ok);
  const req = plan.request;
  assert.equal(req.ownerKind, "story");
  assert.equal(req.ownerRef, "story:tito");
  assert.equal(req.language, "es-PY");
  assert.equal(req.outFolder, "stories/tito/video/es");
  assert.equal(req.outName, "tito-es-16x9");
  assert.equal(req.burnCaptions, false);
  assert.deepEqual(
    req.scenes.map((s) => [s.sceneRef, s.audioDurationMs, s.padAfterMs]),
    [
      ["S01", 5000, 900],
      ["S02", 7000, 900],
    ],
  );
  assert.equal(req.scenes[0].visualPath, path.join(ROOT, "books/tito/art/S01.png"));
  assert.equal(req.scenes[0].audioPath, path.join(MEDIA, "stories/tito/audio/es/S01.wav"));
  assert.equal(req.scenes[0].captionText, "Texto de S01, che.");
  assert.equal(req.scenes[0].visualKind, "image");
  assert.notEqual(req.scenes[0].camera, req.scenes[1].camera);
  assert.deepEqual(req.scenes[0].alignment, [{ word: "Texto", startMs: 0, endMs: 400 }]);
});

test("older readers get 600 ms padding", () => {
  const plan = buildStoryRenderRequest({
    ...base,
    ageBand: "9-12",
    sample: false,
    scenes: [sceneInput("S01")],
  });
  assert.ok(plan.ok);
  assert.equal(plan.request.scenes[0].padAfterMs, 600);
});

test("refuses listing every scene that is missing something", () => {
  const plan = buildStoryRenderRequest({
    ...base,
    sample: false,
    scenes: [
      sceneInput("S01"),
      sceneInput("S02", { status: "pending-review" }),
      sceneInput("S03", { takes: false }),
      sceneInput("S04", { text: null }),
      sceneInput("S05", { audio: false }),
      sceneInput("S06", { art: false }),
      sceneInput("S07", { text: "Fin. PENDIENTE" }),
    ],
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.deepEqual(
    plan.missing.map((m) => m.sceneRef),
    ["S02", "S03", "S04", "S05", "S06", "S07"],
  );
  assert.match(plan.missing[1].reasons[0], /no take/);
  assert.match(plan.missing[2].reasons[0], /no es text/);
  assert.match(plan.missing[3].reasons[0], /scene audio not built/);
  assert.match(plan.missing[4].reasons[0], /no selected art/);
});

test("a take of an older text does not count", () => {
  const s = sceneInput("S01");
  const stale = sceneReadiness(
    { sceneRef: "S01", text: { es: "Texto nuevo." }, textStatus: { es: "approved" } },
    "es",
    [take("S01", "Texto viejo.")],
  );
  assert.equal(stale.takesReady, false);
  assert.equal(stale.lines[0].problem, "text_changed");
  const plan = buildStoryRenderRequest({
    ...base,
    sample: false,
    scenes: [{ ...s, readiness: stale }],
  });
  assert.equal(plan.ok, false);
});

test("multi-line scenes need a take per line slot", () => {
  const lines = [
    { speaker: "tito", text: "—¿Vos podés?" },
    { speaker: null, text: "—preguntó Tito." },
  ];
  const ok = sceneInput("S02", { text: "—¿Vos podés? —preguntó Tito.", lines });
  assert.equal(ok.readiness.takesReady, true);
  assert.deepEqual(
    ok.readiness.lines.map((l) => l.slot),
    ["S02#1", "S02#2"],
  );
  const partial = sceneReadiness(
    {
      sceneRef: "S02",
      text: { es: "—¿Vos podés? —preguntó Tito." },
      textStatus: { es: "approved" },
      lines: { es: lines },
    },
    "es",
    [take("S02#1", lines[0].text, { speaker: "tito" })],
  );
  assert.equal(partial.takesReady, false);
  assert.equal(partial.lines[1].problem, "no_take");
});

test("sample mode cuts at about 45 s from the start and only needs those scenes ready", () => {
  // 3 × (12 s + 0.9 s) = 38.7 s; a fourth would be 51.6 s.
  const plan = buildStoryRenderRequest({
    ...base,
    sample: true,
    scenes: [
      sceneInput("S01", { ms: 12000 }),
      sceneInput("S02", { ms: 12000 }),
      sceneInput("S03", { ms: 12000 }),
      sceneInput("S04", { ms: 12000 }),
      sceneInput("S05", { status: "pending-review" }),
    ],
  });
  assert.ok(plan.ok);
  assert.deepEqual(plan.sceneRefs, ["S01", "S02", "S03"]);
  assert.ok(plan.estimatedMs <= SAMPLE_MAX_MS);
  assert.equal(plan.request.outName, "tito-es-16x9-sample");

  // The sample is the leading run of ready scenes: it stops before S02 ...
  const leading = buildStoryRenderRequest({
    ...base,
    sample: true,
    scenes: [
      sceneInput("S01", { ms: 5000 }),
      sceneInput("S02", { takes: false }),
      sceneInput("S03"),
    ],
  });
  assert.ok(leading.ok);
  assert.deepEqual(leading.sceneRefs, ["S01"]);

  // ... and refuses only when the first scene is not ready.
  const blocked = buildStoryRenderRequest({
    ...base,
    sample: true,
    scenes: [sceneInput("S01", { takes: false }), sceneInput("S02", { ms: 5000 })],
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok)
    assert.deepEqual(
      blocked.missing.map((m) => m.sceneRef),
      ["S01"],
    );

  const long = buildStoryRenderRequest({
    ...base,
    sample: true,
    scenes: [sceneInput("S01", { ms: 60000 })],
  });
  assert.ok(long.ok, "the first scene is always in the sample");
});

test("camera moves vary from scene to scene", () => {
  for (let i = 0; i < 12; i++) assert.notEqual(cameraFor(i), cameraFor(i + 1));
});

test("a language with no voice is refused", () => {
  const plan = buildStoryRenderRequest({
    ...base,
    lang: "xx",
    sample: false,
    scenes: [sceneInput("S01")],
  });
  assert.equal(plan.ok, false);
});
