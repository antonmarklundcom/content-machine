import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { sniffMime } from "@/lib/media/sniff";
import {
  importRecording,
  narrate,
  NarrationRefusedError,
  reviewTake,
  selectTake,
  voiceChangeRecording,
} from "@/lib/voice";
import { toneWav } from "@/lib/voice/wav";
import {
  createPronunciation,
  createProfile,
  listTakes,
  reviewPronunciation,
} from "@/lib/voice/store";
import { fakeVoiceCalls, resetFakeVoice } from "@/lib/voice/providers/fake";

import { resetTables, teardown } from "./setup";

/**
 * Phase A (docs/PLAN-build4.md §3.A): the voice engine against a real
 * Postgres, the voice test double and the real ffmpeg (skipped without it).
 */

const ffmpeg = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"]).status === 0;
const skip = ffmpeg
  ? false
  : "ffmpeg is not on PATH (or FFMPEG_PATH): skipping the audio pipeline tests";

let base = "";
let root = "";

beforeEach(async () => {
  process.env.VOICE_FAKE = "1";
  base = mkdtempSync(path.join(tmpdir(), "b4a-"));
  root = path.join(base, "drive");
  mkdirSync(root);
  process.env.MEDIA_ROOT = root;
  resetFakeVoice();
  await resetTables();
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

after(async () => {
  delete process.env.MEDIA_ROOT;
  await teardown();
});

async function profile(over: Partial<Parameters<typeof createProfile>[0]> = {}) {
  return createProfile({
    key: over.key ?? "tania",
    name: over.name ?? "Tania",
    provider: over.provider ?? "azure",
    providerVoiceId: over.providerVoiceId ?? "es-PY-TaniaNeural",
    languages: over.languages ?? ["es-PY", "jopara"],
    ...over,
  });
}

const take = (voiceProfileId: number, over: Partial<Parameters<typeof narrate>[0]> = {}) => ({
  ownerKind: "story_scene" as const,
  ownerRef: "story:tito-salto-chiquito",
  sceneRef: "S01",
  language: "es-PY" as const,
  voiceProfileId,
  text: "Tito vivía cerca del lago Ypacaraí.",
  ...over,
});

test(
  "narrate with the fake writes WAV + MP3, registers both and records the row",
  { skip },
  async () => {
    const voice = await profile({ brandId: "cuentos" });
    await createPronunciation({ term: "Ypacaraí", sayAs: "Ipacaraí", language: "es-PY" });
    const [rule] = await db.select().from(schema.pronunciations);
    await reviewPronunciation(rule.id, "approved", "Anton");

    const result = await narrate(take(voice.id));
    assert.equal(
      result.masterPath,
      `voice/story-scene/story-tito-salto-chiquito/s01/es-py/take-${result.narrationId}.wav`,
    );
    assert.equal(result.playbackPath, result.masterPath.replace(/\.wav$/, ".mp3"));
    assert.ok(existsSync(path.join(root, result.masterPath)));
    assert.ok(existsSync(path.join(root, result.playbackPath)));
    assert.ok(
      result.durationMs > 1500 && result.durationMs < 4000,
      `duration ${result.durationMs}`,
    );
    assert.ok(result.costUsd > 0);
    // Timings come back with the words as written, not as respelled.
    assert.equal(result.alignment?.at(-1)?.word, "Ypacaraí.");

    const [row] = await db
      .select()
      .from(schema.narrations)
      .where(eq(schema.narrations.id, result.narrationId));
    assert.equal(row.status, "done");
    assert.equal(row.provider, "azure");
    assert.equal(row.spokenText, "Tito vivía cerca del lago Ipacaraí.");
    assert.equal(row.inputText, "Tito vivía cerca del lago Ypacaraí.");
    assert.match(row.textHash, /^[0-9a-f]{64}$/);
    assert.equal(fakeVoiceCalls[0].text, "Tito vivía cerca del lago Ipacaraí.");

    const assets = await db.select().from(schema.assets);
    const master = assets.find((a) => a.id === row.masterAssetId);
    const playback = assets.find((a) => a.id === row.playbackAssetId);
    assert.equal(master?.kind, "audio");
    assert.equal(master?.mime, "audio/wav");
    assert.equal(master?.brandId, "cuentos");
    assert.equal(playback?.mime, "audio/mpeg");
    assert.equal(master?.sourceRef, `narration:${row.id}`);

    // Spend was recorded against the cap.
    const spend = await db.select().from(schema.spendLog);
    assert.ok(Number(spend[0]?.costUsd) > 0);

    // The same text again is a new take with the same hash.
    const again = await narrate(take(voice.id));
    const rows = await db.select().from(schema.narrations);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].textHash, rows[1].textHash);
    assert.notEqual(again.masterPath, result.masterPath);
  },
);

test("refusals write no row: Guaraní, consent, inactive, empty text, unknown profile", async () => {
  const voice = await profile();
  const cloned = await profile({
    key: "ana",
    name: "Ana",
    provider: "elevenlabs",
    providerVoiceId: "abc",
    consentStatus: "pending",
    consentPerson: "Ana",
  });
  const expired = await profile({
    key: "luis",
    name: "Luis",
    provider: "elevenlabs",
    providerVoiceId: "def",
    consentStatus: "signed",
    consentPerson: "Luis",
    consentExpiresAt: new Date("2020-01-01T00:00:00Z"),
  });
  const off = await profile({ key: "off", name: "Off", active: false });

  const cases: Array<[Parameters<typeof narrate>[0], string]> = [
    [take(voice.id, { language: "gn", text: "Mba'éichapa" }), "language_not_supported"],
    [take(cloned.id), "consent_missing"],
    [take(expired.id), "consent_missing"],
    [take(off.id), "provider_not_configured"],
    [take(voice.id, { text: "   " }), "empty_text"],
    [take(voice.id, { text: "Texto PENDIENTE de revisión" }), "text_not_approved"],
    [take(9999), "provider_not_configured"],
  ];
  for (const [req, reason] of cases) {
    await assert.rejects(narrate(req), (error: unknown) => {
      assert.ok(error instanceof NarrationRefusedError, String(error));
      assert.equal(error.reason, reason);
      return true;
    });
  }
  assert.equal((await db.select().from(schema.narrations)).length, 0);
  assert.equal(fakeVoiceCalls.length, 0);
});

test("a missing provider key refuses with the Settings field", async () => {
  const voice = await profile({
    key: "eleven",
    name: "Eleven",
    provider: "elevenlabs",
    providerVoiceId: "x",
  });
  process.env.VOICE_FAKE = "0";
  const saved = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    await assert.rejects(narrate(take(voice.id)), (error: unknown) => {
      assert.ok(error instanceof NarrationRefusedError);
      assert.equal(error.reason, "provider_not_configured");
      assert.match(error.message, /ElevenLabs API key \(voice\).*Settings/);
      return true;
    });
  } finally {
    process.env.VOICE_FAKE = "1";
    if (saved !== undefined) process.env.ELEVENLABS_API_KEY = saved;
  }
});

test("a failure after the row is written keeps it as failed with the error", async () => {
  const voice = await profile();
  process.env.MONTHLY_SPEND_CAP_USD = "0";
  try {
    await assert.rejects(narrate(take(voice.id)), /cap/);
  } finally {
    delete process.env.MONTHLY_SPEND_CAP_USD;
  }
  const [row] = await db.select().from(schema.narrations);
  assert.equal(row.status, "failed");
  assert.match(row.error ?? "", /cap/);
});

test(
  "importRecording normalises a WAV to 48 kHz mono + MP3 as a manual take",
  { skip },
  async () => {
    const upload = path.join(base, "upload.wav");
    writeFileSync(upload, toneWav({ durationMs: 1200, sampleRate: 22_050 }));
    const speaker = await profile({
      key: "rosa",
      name: "Rosa (gn)",
      provider: "manual",
      providerVoiceId: null,
      languages: ["gn"],
      consentStatus: "signed",
      consentPerson: "Rosa",
    });

    const result = await importRecording({
      ownerKind: "story_scene",
      ownerRef: "story:tito",
      sceneRef: "S02",
      language: "gn",
      voiceProfileId: speaker.id,
      text: "Tito oiko Ypacaraí ypýpe.",
      filePath: upload,
    });
    assert.ok(Math.abs(result.durationMs - 1200) < 60, `duration ${result.durationMs}`);
    const probe = spawnSync(process.env.FFPROBE_PATH || "ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=sample_rate,channels",
      "-of",
      "csv=p=0",
      path.join(root, result.masterPath),
    ]);
    if (probe.status === 0) assert.equal(probe.stdout.toString().trim(), "48000,1");
    const [row] = await db.select().from(schema.narrations);
    assert.equal(row.provider, "manual");
    assert.equal(row.costUsd, 0);
    assert.equal(row.status, "done");

    // Consent is checked when a profile is given.
    const pending = await profile({
      key: "nn",
      name: "NN",
      provider: "manual",
      providerVoiceId: null,
      languages: ["gn"],
      consentStatus: "revoked",
      consentPerson: "NN",
    });
    await assert.rejects(
      importRecording({
        ownerKind: "free",
        ownerRef: "x",
        language: "gn",
        voiceProfileId: pending.id,
        text: "x",
        filePath: upload,
      }),
      (e: unknown) => e instanceof NarrationRefusedError && e.reason === "consent_missing",
    );
    // An unreadable file fails the take but keeps the row.
    const junk = path.join(base, "junk.wav");
    writeFileSync(junk, "not audio");
    await assert.rejects(
      importRecording({
        ownerKind: "free",
        ownerRef: "x",
        language: "es-PY",
        voiceProfileId: null,
        text: "x",
        filePath: junk,
      }),
      /ffmpeg failed/,
    );
    const failed = await db
      .select()
      .from(schema.narrations)
      .where(eq(schema.narrations.status, "failed"));
    assert.equal(failed.length, 1);
  },
);

test(
  "selectTake keeps exactly one selected per line; reviewTake records the listen",
  { skip },
  async () => {
    const voice = await profile();
    const a = await narrate(take(voice.id));
    const b = await narrate(take(voice.id));
    const other = await narrate(take(voice.id, { sceneRef: "S02" }));
    const en = await profile({
      key: "en",
      name: "En",
      languages: ["en"],
      providerVoiceId: "en-US-AvaNeural",
    });
    const english = await narrate(
      take(en.id, { language: "en", text: "Tito lived near the lake." }),
    );

    await selectTake(other.narrationId);
    await selectTake(english.narrationId);
    await selectTake(a.narrationId);
    await selectTake(b.narrationId);
    await selectTake(b.narrationId); // idempotent

    const rows = await db.select().from(schema.narrations);
    const selected = rows
      .filter((r) => r.selected)
      .map((r) => r.id)
      .sort();
    assert.deepEqual(selected, [b.narrationId, other.narrationId, english.narrationId].sort());

    await reviewTake(b.narrationId, "approved", "Good pace", "Anton");
    const [reviewed] = await db
      .select()
      .from(schema.narrations)
      .where(eq(schema.narrations.id, b.narrationId));
    assert.equal(reviewed.reviewStatus, "approved");
    assert.equal(reviewed.reviewNote, "Good pace");
    assert.equal(reviewed.reviewedBy, "Anton");

    const listed = await listTakes({
      ownerKind: "story_scene",
      ownerRef: "story:tito-salto-chiquito",
      sceneRef: "S01",
      language: "es-PY",
    });
    assert.deepEqual(
      listed.map((t) => t.id),
      [b.narrationId, a.narrationId],
    );
    const [playback] = await db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, reviewed.playbackAssetId!));
    assert.ok(playback?.localPath);
    const sourceBytes = readFileSync(path.join(root, ...b.playbackPath.split("/")));
    const sha = createHash("sha256").update(sourceBytes).digest("hex");
    assert.equal(playback.sha256, sha);
    assert.equal(playback.localPath, `_originals/${sha.slice(0, 2)}/${sha}.mp3`);
    assert.equal(playback.bytes, sourceBytes.length);
    assert.equal(playback.kind, "audio");
    assert.equal(playback.mime, "audio/mpeg");
    assert.equal(sniffMime(sourceBytes)?.mime, playback.mime);
    assert.deepEqual(readFileSync(path.join(root, ...playback.localPath.split("/"))), sourceBytes);
    assert.equal(listed[0].playbackAssetId, reviewed.playbackAssetId);
    assert.equal(listed[0].playbackPath, playback.localPath);
    assert.equal(listed[0].profileName, "Tania");
  },
);

test("selectTake refuses a failed take", async () => {
  const voice = await profile();
  process.env.MONTHLY_SPEND_CAP_USD = "0";
  await narrate(take(voice.id)).catch(() => undefined);
  delete process.env.MONTHLY_SPEND_CAP_USD;
  const [row] = await db.select().from(schema.narrations);
  await assert.rejects(selectTake(row.id), /only a finished take/);
});

test(
  "voice changer: needs the source speaker's consent; with it, a take is made",
  { skip },
  async () => {
    const upload = path.join(base, "native.wav");
    writeFileSync(upload, toneWav({ durationMs: 800 }));
    const target = await profile({
      key: "eleven",
      name: "Eleven",
      provider: "elevenlabs",
      providerVoiceId: "v1",
    });
    const req = {
      ownerKind: "story_scene" as const,
      ownerRef: "story:tito",
      sceneRef: "S03",
      language: "gn" as const,
      voiceProfileId: target.id,
      text: "Mba'éichapa",
      filePath: upload,
    };
    await assert.rejects(
      voiceChangeRecording({ ...req, sourceSpeakerConsent: false }),
      (e: unknown) => e instanceof NarrationRefusedError && e.reason === "consent_missing",
    );
    const result = await voiceChangeRecording({ ...req, sourceSpeakerConsent: true });
    assert.ok(result.durationMs > 600);
    const [row] = await db.select().from(schema.narrations);
    assert.equal(row.provider, "elevenlabs");
    assert.equal(row.status, "done");
  },
);
