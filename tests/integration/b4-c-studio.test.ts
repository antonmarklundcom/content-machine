import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import sharp from "sharp";

import { db, schema } from "@/db";
import { getScene, getStory, listStoryTakes } from "@/lib/stories/data";
import { EXPORT_MANIFEST, exportToCuentos, type ExportManifest } from "@/lib/stories/export";
import { importStories } from "@/lib/stories/import";
import { readSceneMeta } from "@/lib/stories/meta";
import { sceneReadiness } from "@/lib/stories/readiness";
import {
  approveSceneText,
  approveStoryLanguage,
  LINE_GAP_MS,
  narrateScene,
  renderStory,
  reviewSceneTake,
  StoryError,
  uploadSceneRecording,
} from "@/lib/stories/studio";

import {
  fakeDurationMs,
  fakeEngines,
  makeCuentosRoot,
  SLUG,
  toneWav,
  treeHashes,
} from "./b4-c-fakes";
import { resetTables, teardown } from "./setup";

/**
 * Phase C (build 4 §3.C.4–7) against fake voice/video engines that write real
 * WAVs and rows: narration requests, scene-audio joining with ffmpeg, render
 * requests (refusals, sample cut), and an export that writes only its own files.
 */

function hasFfmpeg(): boolean {
  try {
    execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync(process.env.FFPROBE_PATH || "ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const FFMPEG = hasFfmpeg();
const needsFfmpeg = FFMPEG
  ? {}
  : { skip: "ffmpeg/ffprobe not on PATH — scene audio cannot be joined" };

let cuentos = "";
let media = "";
let narratorId = 0;
let titoId = 0;

beforeEach(async () => {
  await resetTables();
  cuentos = await makeCuentosRoot();
  media = mkdtempSync(path.join(tmpdir(), "media-c-"));
  process.env.CUENTOS_ROOT = cuentos;
  process.env.MEDIA_ROOT = media;
  await importStories();
  const [narrator] = await insertReturning(
    db,
    schema.voiceProfiles,
    {
      key: "narradora-py",
      name: "Narradora PY",
      provider: "elevenlabs",
      languages: ["es-PY"],
      role: "narrator",
    },
    { id: schema.voiceProfiles.id },
  );
  const [tito] = await insertReturning(
    db,
    schema.voiceProfiles,
    {
      key: "tito",
      name: "Tito",
      provider: "elevenlabs",
      languages: ["es-PY"],
      role: "character",
      characterKey: "tito",
    },
    { id: schema.voiceProfiles.id },
  );
  narratorId = narrator.id;
  titoId = tito.id;
});

afterEach(() => {
  rmSync(cuentos, { recursive: true, force: true });
  rmSync(media, { recursive: true, force: true });
  delete process.env.CUENTOS_ROOT;
  delete process.env.MEDIA_ROOT;
});

after(teardown);

test("Guaraní: no TTS, and no take for missing or pending text", async () => {
  const { deps, narrated, uploaded } = fakeEngines();
  await assert.rejects(
    narrateScene({ slug: SLUG, sceneRef: "S01", lang: "gn" }, deps),
    (e: unknown) => {
      return e instanceof StoryError && e.code === "upload_only";
    },
  );
  const file = path.join(media, "upload.wav");
  writeFileSync(file, toneWav(800));
  // S01 gn exists but is pending review; S02 has no gn text at all.
  for (const sceneRef of ["S01", "S02"]) {
    await assert.rejects(
      uploadSceneRecording(
        { slug: SLUG, sceneRef, lang: "gn", slot: sceneRef, filePath: file },
        deps,
      ),
      (e: unknown) => e instanceof StoryError && e.code === "text_refused",
    );
  }
  // Pending es text refuses narration too; nothing reached the engine.
  await assert.rejects(
    narrateScene({ slug: SLUG, sceneRef: "S03", lang: "es" }, deps),
    /not approved/,
  );
  assert.equal(narrated.length + uploaded.length, 0);
});

test("an approved Guaraní scene takes an uploaded recording as a manual take", async () => {
  const { deps, uploaded } = fakeEngines();
  await approveSceneText(SLUG, "S01", "gn", "revisora@example.com");
  const file = path.join(media, "upload.wav");
  writeFileSync(file, toneWav(800));
  const r = await uploadSceneRecording(
    { slug: SLUG, sceneRef: "S01", lang: "gn", slot: "S01", filePath: file },
    deps,
  );
  assert.equal(r.selected, true);
  assert.equal(uploaded[0].language, "gn");
  assert.equal(uploaded[0].text, "Tito ha'e peteĩ kururu'i michĩ.");
  assert.equal(uploaded[0].ownerRef, `story:${SLUG}`);
});

test(
  "narration requests: verbatim text, scene slots, narrator and character profiles",
  needsFfmpeg,
  async () => {
    const { deps, narrated } = fakeEngines();
    await narrateScene({ slug: SLUG, sceneRef: "S01", lang: "es" }, deps);
    await narrateScene({ slug: SLUG, sceneRef: "S02", lang: "es" }, deps);
    assert.deepEqual(narrated[0], {
      ownerKind: "story_scene",
      ownerRef: `story:${SLUG}`,
      sceneRef: "S01",
      language: "es-PY",
      voiceProfileId: narratorId,
      text: "Tito era un sapito chiquito que vivía junto al arroyo.",
      speaker: null,
      pronunciationScope: `story:${SLUG}`,
    });
    assert.deepEqual(
      narrated.slice(1).map((n) => [n.sceneRef, n.speaker, n.voiceProfileId, n.text]),
      [
        ["S02#1", "tito", titoId, "—¿Vos podés saltar tan alto?"],
        ["S02#2", null, narratorId, "—preguntó Tito. La garza se rió despacito."],
      ],
    );
    // A second Narrate with every line ready re-takes nothing unless asked; with `all` it re-takes both.
    await narrateScene({ slug: SLUG, sceneRef: "S02", lang: "es", all: true }, deps);
    assert.equal(narrated.length, 5);
    const takes = await listStoryTakes(SLUG);
    assert.equal(takes.filter((t) => t.sceneRef === "S02#1").length, 2, "every take is kept");
    assert.equal(
      takes.filter((t) => t.sceneRef === "S02#1" && t.selected).length,
      1,
      "the first stays selected",
    );
  },
);

test(
  "scene audio: lines joined 250 ms apart, measured, timings shifted, registered",
  needsFfmpeg,
  async () => {
    const { deps } = fakeEngines();
    const r = await narrateScene({ slug: SLUG, sceneRef: "S02", lang: "es" }, deps);
    assert.ok(r.audio, `scene audio built (${r.notes.join("; ")})`);
    const audio = r.audio!;
    assert.equal(audio.wavPath, `stories/${SLUG}/audio/es/S02.wav`);
    assert.equal(audio.mp3Path, `stories/${SLUG}/audio/es/S02.mp3`);
    assert.ok(existsSync(path.join(media, audio.wavPath)));
    assert.ok(existsSync(path.join(media, audio.mp3Path!)));
    const d1 = fakeDurationMs("—¿Vos podés saltar tan alto?");
    const d2 = fakeDurationMs("—preguntó Tito. La garza se rió despacito.");
    assert.ok(
      Math.abs(audio.durationMs - (d1 + LINE_GAP_MS + d2)) < 40,
      `measured ${audio.durationMs}`,
    );
    const second = audio.alignment!.find((w) => w.word === "—preguntó")!;
    assert.ok(
      Math.abs(second.startMs - (d1 + LINE_GAP_MS)) < 40,
      "line 2 timings start after line 1 + gap",
    );
    const [asset] = await db.select().from(schema.assets);
    assert.ok(asset);
    const stored = readSceneMeta((await getScene((await getStory(SLUG))!.id, "S02"))!.notes).audio
      ?.es;
    assert.deepEqual(stored?.takeIds, audio.takeIds);
  },
);

test(
  "render: refuses listing missing scenes, then renders the full story and the sample",
  needsFfmpeg,
  async () => {
    const { deps, rendered } = fakeEngines();
    for (const s of ["S01", "S02"])
      await narrateScene({ slug: SLUG, sceneRef: s, lang: "es" }, deps);
    await approveSceneText(SLUG, "S03", "es", "anton@example.com");
    await narrateScene({ slug: SLUG, sceneRef: "S03", lang: "es" }, deps);

    await assert.rejects(
      renderStory({ slug: SLUG, lang: "es", format: "16x9", sample: false }, deps),
      (e: unknown) => {
        assert.ok(e instanceof StoryError && e.code === "not_ready");
        assert.deepEqual(
          e.missing?.map((m) => m.sceneRef),
          ["S04"],
        );
        assert.match(e.missing![0].reasons.join(" "), /pending-review notice/);
        return true;
      },
    );
    await assert.rejects(
      renderStory({ slug: SLUG, lang: "gn", format: "16x9", sample: false }, deps),
      /S01/,
    );
    assert.equal(rendered.length, 0);

    // A sample is the leading run of ready scenes: it stops before S04.
    const early = await renderStory({ slug: SLUG, lang: "es", format: "16x9", sample: true }, deps);
    assert.deepEqual(early.sceneRefs, ["S01", "S02", "S03"]);
    assert.equal(rendered.length, 1);
    rendered.length = 0;

    // The repo fixes S04 and adds its art; re-import, narrate, render.
    const storyFile = path.join(cuentos, "books", SLUG, "story.json");
    const json = JSON.parse(readFileSync(storyFile, "utf8"));
    json.pages[3].text.es = "Fue un salto chiquito, pero era su salto.";
    writeFileSync(storyFile, JSON.stringify(json));
    const png = await sharp({
      create: { width: 80, height: 100, channels: 3, background: "#e83d3d" },
    })
      .png()
      .toBuffer();
    writeFileSync(path.join(cuentos, "books", SLUG, "art", "S04.png"), png);
    await importStories();
    await narrateScene({ slug: SLUG, sceneRef: "S04", lang: "es" }, deps);

    const full = await renderStory({ slug: SLUG, lang: "es", format: "16x9", sample: false }, deps);
    assert.deepEqual(full.sceneRefs, ["S01", "S02", "S03", "S04"]);
    const req = rendered[0];
    assert.equal(req.ownerKind, "story");
    assert.equal(req.language, "es-PY");
    assert.equal(req.outFolder, `stories/${SLUG}/video/es`);
    assert.equal(req.outName, `${SLUG}-es-16x9`);
    assert.ok(
      req.scenes.every((s) => s.padAfterMs === 900),
      "preschool pacing",
    );
    assert.ok(req.scenes.every((s, i) => i === 0 || s.camera !== req.scenes[i - 1].camera));
    assert.equal(req.scenes[0].visualPath, path.join(cuentos, "books", SLUG, "art", "S01-a.png"));
    assert.ok(req.scenes[1].audioPath?.startsWith(media));
    assert.equal(req.scenes[1].captionText, json.pages[1].text.es);
    for (const s of req.scenes) {
      const actual = Math.round(
        Number(
          execFileSync(process.env.FFPROBE_PATH || "ffprobe", [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            s.audioPath!,
          ]).toString(),
        ) * 1000,
      );
      assert.ok(Math.abs(actual - s.audioDurationMs) <= 2, `${s.sceneRef}: durations are measured`);
    }

    const sample = await renderStory(
      { slug: SLUG, lang: "es", format: "9x16", sample: true },
      deps,
    );
    assert.equal(rendered[1].outName, `${SLUG}-es-9x16-sample`);
    assert.ok(sample.sceneRefs.length >= 1);
  },
);

test("a rejected take or a changed text stops the scene being ready", needsFfmpeg, async () => {
  const { deps } = fakeEngines();
  await narrateScene({ slug: SLUG, sceneRef: "S01", lang: "es" }, deps);
  const take = (await listStoryTakes(SLUG)).find((t) => t.sceneRef === "S01")!;
  await reviewSceneTake(SLUG, take.id, "rejected", "anton", "suena rara", deps);
  const story = (await getStory(SLUG))!;
  let scene = (await getScene(story.id, "S01"))!;
  assert.equal(
    sceneReadiness(scene, "es", await listStoryTakes(SLUG)).lines[0].problem,
    "rejected",
  );

  await reviewSceneTake(SLUG, take.id, "approved", "anton", null, deps);
  const storyFile = path.join(cuentos, "books", SLUG, "story.json");
  const json = JSON.parse(readFileSync(storyFile, "utf8"));
  json.pages[0].text.es = "Tito era un sapito chiquito que vivía junto al arroyo Ypacaraí.";
  writeFileSync(storyFile, JSON.stringify(json));
  await importStories();
  scene = (await getScene(story.id, "S01"))!;
  assert.equal(
    sceneReadiness(scene, "es", await listStoryTakes(SLUG)).lines[0].problem,
    "text_changed",
  );
});

test(
  "export writes only its own files under the book's audio/ and never overwrites the repo's",
  needsFfmpeg,
  async () => {
    const { deps } = fakeEngines();
    await narrateScene({ slug: SLUG, sceneRef: "S01", lang: "es" }, deps);
    await narrateScene({ slug: SLUG, sceneRef: "S02", lang: "es" }, deps);
    // The repo already has its own S02 recording.
    const own = path.join(cuentos, "books", SLUG, "audio", "es", "S02.wav");
    mkdirSync(path.dirname(own), { recursive: true });
    writeFileSync(own, toneWav(300));

    const before = treeHashes(cuentos);
    const r = await exportToCuentos(SLUG, "es");
    const afterExport = treeHashes(cuentos);

    for (const [file, hash] of Object.entries(before))
      assert.equal(afterExport[file], hash, `${file} untouched`);
    const added = Object.keys(afterExport)
      .filter((f) => !(f in before))
      .sort();
    assert.deepEqual(added, [
      `books/${SLUG}/audio/es/S01.mp3`,
      `books/${SLUG}/audio/es/S01.wav`,
      `books/${SLUG}/audio/${EXPORT_MANIFEST}`,
    ]);
    assert.deepEqual(r.written, ["audio/es/S01.wav", "audio/es/S01.mp3"]);
    assert.match(r.skipped[0], /audio\/es\/S02\.wav \(already there/);
    assert.deepEqual(r.missing, ["S03", "S04"]);

    const manifest = JSON.parse(
      readFileSync(path.join(cuentos, "books", SLUG, "audio", EXPORT_MANIFEST), "utf8"),
    ) as ExportManifest;
    assert.equal(manifest.generator, "content-engine");
    const s01 = manifest.languages.es.scenes[0];
    assert.equal(s01.sceneRef, "S01");
    assert.deepEqual(s01.voiceProfileKeys, ["narradora-py"]);
    assert.equal(
      s01.durationMs,
      fakeDurationMs("Tito era un sapito chiquito que vivía junto al arroyo."),
    );
    assert.equal(s01.textStatus, "approved");

    // A second export may overwrite its own files, still not the repo's.
    const again = await exportToCuentos(SLUG, "es");
    assert.deepEqual(again.written, ["audio/es/S01.wav", "audio/es/S01.mp3"]);
    assert.equal(
      treeHashes(cuentos)[`books/${SLUG}/audio/es/S02.wav`],
      before[`books/${SLUG}/audio/es/S02.wav`],
    );
  },
);

test("approve all: every Spanish scene that can take it, pending notices skipped, never Guaraní", async () => {
  const r = await approveStoryLanguage(SLUG, "es", "anton@example.com");
  assert.deepEqual(r.approved, ["S03"]);
  assert.deepEqual(r.already.sort(), ["S01", "S02"]);
  assert.deepEqual(
    r.skipped.map((s) => s.sceneRef),
    ["S04"],
  );
  assert.match(r.skipped[0].reason, /PENDIENTE|pending/i);
  await assert.rejects(approveStoryLanguage(SLUG, "gn", "anton@example.com"), /scene by scene/);
});
