import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/db";
import {
  previewStoryVoiceAction,
  queueStoryVoiceAction,
  queueVoiceAction,
} from "@/lib/higgsfield-voice.actions";
import { resetPreflightCache } from "@/lib/higgsfield/preflight";
import { getJob, settleRuns } from "@/lib/higgsfield/run";
import { buildVoiceRunPrompt, voiceArgument, voiceOutFile } from "@/lib/higgsfield/voice";
import { sampleScriptBody } from "@/lib/scripts/fixture";
import { narrationFolder } from "@/lib/storage/paths";
import { getScene, getStory } from "@/lib/stories/data";
import { importStories } from "@/lib/stories/import";
import { readSceneMeta } from "@/lib/stories/meta";
import { NarrationRefusedError, type VoiceSettings } from "@/lib/voice/contract";
import {
  finalizeHiggsfieldVoiceJob,
  HiggsfieldVoiceError,
  planHiggsfieldVoice,
  queueHiggsfieldVoice,
  scriptVoiceLines,
  storyVoiceLines,
  type VoiceLineRequest,
} from "@/lib/voice/higgsfield-takes";

import { makeCuentosRoot, SLUG, toneWav } from "./b4-c-fakes";
import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * Phase A of build 5 (docs/PLAN-build5.md §1.1–1.4): Higgsfield voice batches
 * against a fake `claude` (`b5-a-fake-claude.mjs`) — no Claude, no Higgsfield,
 * no credits. Covers the line manifest (refusals, Guaraní, pronunciations,
 * estimates, the ceiling), the job lifecycle, finalize (files → takes,
 * credits, selection, story scene audio) and its idempotency.
 */

const FAKE = path.resolve("tests/integration/b5-a-fake-claude.mjs");
const ENV_KEYS = [
  "MEDIA_ROOT",
  "CUENTOS_ROOT",
  "CLAUDE_CLI_PATH",
  "CLAUDE_CLI_BIN",
  "HIGGSFIELD_MCP_SERVER",
  "FAKE_VOICE_FAIL",
  "FAKE_VOICE_CREDITS",
  "FAKE_VOICE_LOG",
];

function hasFfmpeg(): boolean {
  try {
    execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync(process.env.FFPROBE_PATH || "ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const needsFfmpeg = hasFfmpeg() ? {} : { skip: "ffmpeg/ffprobe not on PATH" };

const { workAsyncStorage } = createRequire(import.meta.url)(
  "next/dist/server/app-render/work-async-storage.external",
) as { workAsyncStorage: { getStore(): Record<string, unknown> | undefined } };

async function as<T>(cookie: string, action: () => Promise<T>): Promise<T> {
  let result: T | undefined;
  let error: unknown;
  await callRoute(
    async () => {
      workAsyncStorage.getStore()!.incrementalCache = {};
      try {
        result = await action();
      } catch (e) {
        error = e;
      }
      return new Response(null);
    },
    new Request("http://localhost/stories", { method: "POST", headers: { cookie } }),
  );
  if (error) throw error;
  return result as T;
}

let base = "";
let media = "";
let cuentos = "";
let log = "";
let narratorId = 0;
let titoId = 0;
let elementId = 0;
let elevenId = 0;
let qwenId = 0;

const HF = (model: string, voiceId: string, extra: Record<string, unknown> = {}) =>
  ({ higgsfield: { model, voiceType: "preset", voiceId, ...extra } }) as VoiceSettings;

async function profile(
  values: Partial<typeof schema.voiceProfiles.$inferInsert> & { key: string },
) {
  const [row] = await insertReturning(
    db,
    schema.voiceProfiles,
    { name: values.key, provider: "higgsfield", languages: ["es-PY"], ...values },
    { id: schema.voiceProfiles.id },
  );
  return row.id;
}

beforeEach(async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  resetPreflightCache();
  await resetTables();
  base = mkdtempSync(path.join(tmpdir(), "b5a-"));
  media = path.join(base, "drive");
  mkdirSync(media);
  log = path.join(base, "claude.log");
  cuentos = await makeCuentosRoot();
  process.env.MEDIA_ROOT = media;
  process.env.CUENTOS_ROOT = cuentos;
  process.env.CLAUDE_CLI_PATH = FAKE;
  process.env.HIGGSFIELD_MCP_SERVER = "higgsfield";
  process.env.FAKE_VOICE_LOG = log;
  narratorId = await profile({
    key: "hf-narradora",
    providerVoiceId: "v-es",
    settings: HF("text2speech_v2", "v-es", { variant: "elevenlabs" }),
  });
  titoId = await profile({
    key: "hf-tito",
    role: "character",
    characterKey: "tito",
    providerVoiceId: "v-tito",
    settings: HF("elevenlabs_v4", "v-tito"),
  });
  elementId = await profile({
    key: "hf-ana",
    providerVoiceId: "el-ana",
    settings: HF("text2speech_v2", "el-ana", { variant: "minimax", voiceType: "element" }),
    consentStatus: "pending",
    consentPerson: "Ana",
  });
  elevenId = await profile({ key: "eleven", provider: "elevenlabs", providerVoiceId: "x" });
  qwenId = await profile({
    key: "hf-qwen",
    languages: ["es-PY", "en"],
    providerVoiceId: "q",
    settings: HF("qwen_audio_tts", "q"),
  });
});

afterEach(async () => {
  await settleRuns();
  rmSync(base, { recursive: true, force: true });
  rmSync(cuentos, { recursive: true, force: true });
});

after(async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  await teardown();
});

const line = (over: Partial<VoiceLineRequest> = {}): VoiceLineRequest => ({
  ownerKind: "free",
  ownerRef: "free:hf-test",
  sceneRef: "a",
  language: "es-PY",
  voiceProfileId: narratorId,
  text: "Vamos a Ypacaraí mañana temprano.",
  speaker: null,
  ...over,
});

const rowsOf = (ids: number[]) =>
  db.select().from(schema.narrations).where(inArray(schema.narrations.id, ids));

test("the manifest: narrate()'s refusals, never Guaraní, pronunciations, estimates", async () => {
  await db.insert(schema.pronunciations).values({
    term: "Ypacaraí",
    sayAs: "Ipacaraí",
    language: "*",
    scope: "global",
    reviewStatus: "approved",
  });
  const plan = await planHiggsfieldVoice([
    line(),
    line({ sceneRef: "gn", language: "gn", text: "Mba'éichapa" }),
    line({ sceneRef: "empty", text: "   " }),
    line({ sceneRef: "pending", text: "Fin. PENDIENTE: revisar" }),
    line({ sceneRef: "clone", voiceProfileId: elementId }),
    line({ sceneRef: "eleven", voiceProfileId: elevenId }),
    line({ sceneRef: "qwen", voiceProfileId: qwenId }),
    line({ sceneRef: "qwen-en", voiceProfileId: qwenId, language: "en", text: "Hello" }),
    line({ sceneRef: "nobody", voiceProfileId: 99999 }),
  ]);
  assert.deepEqual(
    plan.refused.map((r) => [r.request.sceneRef, r.reason]),
    [
      ["gn", "language_not_supported"],
      ["empty", "empty_text"],
      ["pending", "text_not_approved"],
      ["clone", "consent_missing"],
      ["eleven", "provider_not_configured"],
      ["qwen", "language_not_supported"],
      ["nobody", "provider_not_configured"],
    ],
  );
  assert.deepEqual(
    plan.planned.map((p) => p.request.sceneRef),
    ["a", "qwen-en"],
  );
  assert.equal(plan.planned[0].spokenText, "Vamos a Ipacaraí mañana temprano.");
  // 33 characters of text2speech_v2/elevenlabs at 2.7 per 950 → 0.1 (rounded up).
  assert.equal(plan.planned[0].estimateCredits, 0.1);
  assert.equal(plan.estimateCredits, 0.11);

  // A signed clone is fine.
  await db
    .update(schema.voiceProfiles)
    .set({ consentStatus: "signed" })
    .where(eq(schema.voiceProfiles.id, elementId));
  const signed = await planHiggsfieldVoice([line({ voiceProfileId: elementId })]);
  assert.equal(signed.planned.length, 1);
  assert.equal(signed.planned[0].settings.voiceType, "element");

  // A refused line refuses the batch; the ceiling refuses before anything is written.
  await assert.rejects(
    queueHiggsfieldVoice({ lines: [line(), line({ language: "gn" })], maxCredits: 10 }),
    (e: unknown) => e instanceof NarrationRefusedError && e.reason === "language_not_supported",
  );
  const long = "Tito saltó. ".repeat(200);
  await assert.rejects(
    queueHiggsfieldVoice({ lines: [line({ text: long })], maxCredits: 1 }),
    (e: unknown) => e instanceof HiggsfieldVoiceError && /above the ceiling of 1/.test(e.message),
  );
  assert.equal((await db.select().from(schema.narrations)).length, 0);
  assert.equal((await db.select().from(schema.higgsfieldJobs)).length, 0);
  assert.equal(existsSync(log), false, "claude never ran");
});

test(
  "a queued batch: pending rows → voice job → takes done with credits, job ids, selection",
  needsFfmpeg,
  async () => {
    process.env.FAKE_VOICE_CREDITS = "3";
    const q = await queueHiggsfieldVoice({
      lines: [line(), line({ sceneRef: "b", text: "Y después volvemos a casa, despacito." })],
      maxCredits: 10,
      targetRef: "voice:free:hf-test",
    });
    assert.equal(q.job.kind, "voice");
    assert.equal(q.job.targetRef, "voice:free:hf-test");
    const pending = await rowsOf(q.narrationIds);
    assert.ok(pending.every((r) => r.provider === "higgsfield" && r.higgsfieldJobId === q.job.id));

    const job = await q.finished;
    assert.equal(job.status, "done", job.error ?? job.log ?? "");
    assert.deepEqual(
      job.externalJobIds,
      q.narrationIds.map((id) => `hf-${id}`),
    );
    assert.equal(job.creditsUsed, 3);
    assert.match(job.log ?? "", /\[voice\] 2 take\(s\) made, 0 failed, 2 selected/);

    // What the CLI got: the voice command, the manifest with job ref + ceiling, the run rules.
    const call = JSON.parse(readFileSync(log, "utf8").trim()) as { stdin: string };
    assert.ok(call.stdin.startsWith("/higgsfield-voice ```json"));
    assert.ok(call.stdin.includes(`"jobRef": "content-engine job #${job.id}"`));
    assert.ok(call.stdin.includes('"ceilingCredits": 10'));
    assert.ok(call.stdin.includes("Spend at most 10 credits"));
    assert.equal(job.prompt, call.stdin);

    const rows = (await rowsOf(q.narrationIds)).sort((a, b) => a.id - b.id);
    let total = 0;
    for (const r of rows) {
      assert.equal(r.status, "done", r.error ?? "");
      assert.equal(r.externalRef, `hf-${r.id}`);
      assert.equal(r.selected, true);
      assert.ok((r.durationMs ?? 0) > 400);
      assert.ok(r.costCredits! > 0);
      total += r.costCredits!;
      const assets = await db
        .select()
        .from(schema.assets)
        .where(inArray(schema.assets.id, [r.masterAssetId!, r.playbackAssetId!]));
      const paths = assets.map((a) => a.localPath).sort();
      const folder = narrationFolder(r);
      assert.deepEqual(paths, [`${folder}/take-${r.id}.mp3`, `${folder}/take-${r.id}.wav`]);
      assert.equal(
        existsSync(path.join(media, ...`${folder}/take-${r.id}.hf.mp3`.split("/"))),
        false,
      );
    }
    assert.equal(Math.round(total * 100) / 100, 3);
    // The longer line carries more of the credits.
    assert.ok(rows[1].costCredits! > rows[0].costCredits!);

    // Finalize again: nothing changes.
    const again = await finalizeHiggsfieldVoiceJob(job.id, null);
    assert.deepEqual(again, { done: [], failed: [], selected: [], notes: [] });

    // A line Higgsfield fails: failed with the reason; the credits go to the line that made a take.
    process.env.FAKE_VOICE_FAIL = "1";
    const q2 = await queueHiggsfieldVoice({
      lines: [line({ sceneRef: "c" }), line({ sceneRef: "d", text: "Otra frase." })],
      maxCredits: 10,
    });
    await q2.finished;
    const [ok, bad] = (await rowsOf(q2.narrationIds)).sort((a, b) => a.id - b.id);
    assert.equal(ok.status, "done");
    assert.equal(ok.costCredits, 3);
    assert.equal(bad.status, "failed");
    assert.equal(bad.error, "Higgsfield: voice id not found");
    assert.equal(bad.externalRef, `hf-${bad.id}`);
  },
);

test(
  "a book language: ready lines without a usable take, selected, scene audio built",
  needsFfmpeg,
  async () => {
    await importStories();
    const batch = await storyVoiceLines(SLUG, "es", narratorId);
    // S01 (one line) and S02's two lines; S03 is not approved, S04 carries PENDIENTE.
    assert.deepEqual(
      batch.lines.map((l) => [l.sceneRef, l.speaker, l.voiceProfileId]),
      [
        ["S01", null, narratorId],
        ["S02#1", "tito", titoId],
        // The import reads the audio script's "narrador" as the narrator (speaker null).
        ["S02#2", null, narratorId],
      ],
    );
    await assert.rejects(storyVoiceLines(SLUG, "gn", narratorId), NarrationRefusedError);
    await assert.rejects(storyVoiceLines(SLUG, "es", elevenId), HiggsfieldVoiceError);

    const q = await queueHiggsfieldVoice({
      lines: batch.lines,
      maxCredits: 5,
      targetRef: batch.targetRef,
    });
    const job = await q.finished;
    assert.equal(job.status, "done", job.log ?? "");
    const rows = await rowsOf(q.narrationIds);
    assert.ok(
      rows.every((r) => r.status === "done" && r.selected),
      JSON.stringify(rows),
    );
    // The manifest went to Claude with the engines per line (tito's is elevenlabs_v4).
    assert.ok(job.prompt.includes('"model": "elevenlabs_v4"'));

    const story = (await getStory(SLUG))!;
    for (const ref of ["S01", "S02"]) {
      const audio = readSceneMeta((await getScene(story.id, ref))!.notes).audio?.es;
      assert.ok(audio, `${ref} scene audio built`);
      assert.ok(audio.durationMs > 400);
    }
    const s02 = readSceneMeta((await getScene(story.id, "S02"))!.notes).audio!.es;
    assert.equal(s02.takeIds.length, 2);

    // Everything has a usable take now: nothing left to queue.
    assert.equal((await storyVoiceLines(SLUG, "es", narratorId)).lines.length, 0);
  },
);

test(
  "finalize with files dropped where the command writes (MP3), script lines, idempotent",
  needsFfmpeg,
  async () => {
    const [brandless] = await insertReturning(db, schema.scripts, {
      brandId: "guide",
      title: "T",
      language: "es-PY",
      body: sampleScriptBody(),
    });
    const batch = await scriptVoiceLines(brandless.id, narratorId);
    assert.deepEqual(
      batch.lines.map((l) => l.sceneRef),
      ["hook", "s01", "cta"],
    );
    assert.equal(batch.targetRef, `voice:script:${brandless.id}`);

    // A job row and pending rows as queueHiggsfieldVoice writes them, without running claude.
    const plan = await planHiggsfieldVoice(batch.lines.slice(0, 2));
    const ids: number[] = [];
    const manifestLines = [];
    for (const p of plan.planned) {
      const [row] = await insertReturning(
        db,
        schema.narrations,
        {
          ownerKind: "script",
          ownerRef: p.request.ownerRef,
          sceneRef: p.request.sceneRef,
          language: p.request.language,
          voiceProfileId: p.profile.id,
          inputText: p.request.text,
          spokenText: p.spokenText,
          textHash: "0".repeat(64),
          provider: "higgsfield",
          status: "pending",
        },
        { id: schema.narrations.id },
      );
      ids.push(row.id);
      manifestLines.push({
        lineId: row.id,
        model: p.settings.model,
        variant: p.settings.variant,
        voiceType: p.settings.voiceType,
        voiceId: p.settings.voiceId,
        text: p.spokenText,
        outFile: voiceOutFile(narrationFolder(p.request), row.id, p.settings.model),
        estimateCredits: p.estimateCredits,
      });
    }
    const [jobRow] = await insertReturning(db, schema.higgsfieldJobs, {
      kind: "voice",
      prompt: "(building)",
      maxCredits: 5,
      status: "done",
      log: `HF_JOB ${ids[0]} ext-${ids[0]}\nHF_CREDITS 1.5\n`,
    });
    await db
      .update(schema.higgsfieldJobs)
      .set({
        prompt: buildVoiceRunPrompt({
          jobId: jobRow.id,
          argument: voiceArgument({ jobRef: null, ceilingCredits: 5, lines: manifestLines }),
          maxCredits: 5,
          mediaRoot: media,
        }),
      })
      .where(eq(schema.higgsfieldJobs.id, jobRow.id));
    // Only the first line's MP3 was saved.
    const wav = path.join(base, "src.wav");
    writeFileSync(wav, toneWav(900));
    const out = path.join(media, ...manifestLines[0].outFile.split("/"));
    mkdirSync(path.dirname(out), { recursive: true });
    execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-loglevel", "error", "-y", "-i", wav, out]);

    const r = await finalizeHiggsfieldVoiceJob(jobRow.id, null);
    assert.deepEqual(r.done, [ids[0]]);
    assert.deepEqual(r.failed, [ids[1]]);
    assert.deepEqual(r.selected, [ids[0]]);
    const [done, failed] = (await rowsOf(ids)).sort((a, b) => a.id - b.id);
    assert.equal(done.status, "done");
    assert.equal(done.externalRef, `ext-${ids[0]}`);
    assert.equal(done.costCredits, 1.5);
    assert.equal(done.higgsfieldJobId, jobRow.id);
    assert.ok(Math.abs((done.durationMs ?? 0) - 900) < 120, String(done.durationMs));
    assert.equal(failed.status, "failed");
    assert.match(failed.error ?? "", /No file was saved/);
    const [master] = await db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, done.masterAssetId!));
    assert.ok(master.localPath?.endsWith(`take-${ids[0]}.wav`));
    assert.ok(master.tags.includes("higgsfield"));

    assert.deepEqual(await finalizeHiggsfieldVoiceJob(jobRow.id, null), {
      done: [],
      failed: [],
      selected: [],
      notes: [],
    });
    assert.equal((await getJob(jobRow.id))!.status, "done");
  },
);

test("actions: owner only; a story preview and queue; one line", needsFfmpeg, async () => {
  await importStories();
  const owner = (await signIn("owner")).cookie;
  const employee = (await signIn("employee")).cookie;
  const denied = await as(employee, () => queueStoryVoiceAction(SLUG, "es", narratorId, 5));
  assert.equal(denied.ok, false);

  const preview = await as(owner, () => previewStoryVoiceAction(SLUG, "es", narratorId));
  assert.ok(preview.ok);
  assert.equal(preview.lines, 3);
  assert.ok(preview.estimateCredits > 0);

  const tooLow = await as(owner, () => queueStoryVoiceAction(SLUG, "es", narratorId, 0.01));
  assert.equal(tooLow.ok, false);
  assert.match(!tooLow.ok ? tooLow.error : "", /above the ceiling/);

  const queued = await as(owner, () => queueStoryVoiceAction(SLUG, "es", narratorId, 5));
  assert.ok(queued.ok, !queued.ok ? queued.error : "");
  assert.equal(queued.lines, 3);
  await settleRuns();
  assert.equal((await getJob(queued.jobId))!.status, "done");

  const one = await as(owner, () =>
    queueVoiceAction({
      ownerKind: "free",
      ownerRef: "free:one",
      language: "es-PY",
      voiceProfileId: narratorId,
      text: "Una sola frase.",
      maxCredits: 2,
    }),
  );
  assert.ok(one.ok, !one.ok ? one.error : "");
  await settleRuns();
  const [take] = await db
    .select()
    .from(schema.narrations)
    .where(eq(schema.narrations.ownerRef, "free:one"));
  assert.equal(take.status, "done");
  const gn = await as(owner, () =>
    queueVoiceAction({
      ownerKind: "free",
      ownerRef: "free:one",
      language: "gn",
      voiceProfileId: narratorId,
      text: "Mba'éichapa",
      maxCredits: 2,
    }),
  );
  assert.equal(gn.ok, false);
});
