import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";

import { importRecording, reviewTake, selectTake } from "@/lib/voice";
import { exportDataset, listExports } from "@/lib/voice/dataset/export";
import { datasetOverview } from "@/lib/voice/dataset/query";
import { DatasetConsentError } from "@/lib/voice/dataset/select";
import { createProfile } from "@/lib/voice/store";
import { toneWav } from "@/lib/voice/wav";

import { resetTables, teardown } from "./setup";

/** Phase C (docs/PLAN-build5.md §3.C): a real export from generated WAV takes. */

const ffmpeg = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"]).status === 0;
const skip = ffmpeg ? false : "ffmpeg is not on PATH: skipping the dataset export test";

let base = "";
let root = "";

beforeEach(async () => {
  process.env.VOICE_FAKE = "1";
  base = mkdtempSync(path.join(tmpdir(), "b5c-"));
  root = path.join(base, "drive");
  mkdirSync(root);
  process.env.MEDIA_ROOT = root;
  await resetTables();
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

after(async () => {
  delete process.env.MEDIA_ROOT;
  await teardown();
});

let n = 0;
async function record(voiceProfileId: number, sceneRef: string, text: string, durationMs: number) {
  const file = path.join(base, `in-${++n}.wav`);
  writeFileSync(
    file,
    toneWav({ durationMs, sampleRate: 44_100, frequency: 200 + n * 10, noise: true }),
  );
  return importRecording({
    ownerKind: "story_scene",
    ownerRef: "story:tito",
    sceneRef,
    language: "gn",
    voiceProfileId,
    text,
    filePath: file,
  });
}

test("exports approved manual takes as an LJSpeech folder at 22,050 Hz", { skip }, async () => {
  const rosa = await createProfile({
    key: "rosa",
    name: "Rosa",
    provider: "manual",
    providerVoiceId: null,
    languages: ["gn"],
    consentStatus: "signed",
    consentPerson: "Rosa Benítez",
    consentScope: "AI voice training, commercial, 5 years",
  });
  const gn = "Che ra'y, ãga reg̃uahẽ | ỹ";
  const a = await record(rosa.id, "S01", gn, 2000);
  const b = await record(rosa.id, "S01", "Otra toma", 2200); // same slot, older selected wins
  const c = await record(rosa.id, "S02", "Mbohapy\nmymba", 1800);
  const short = await record(rosa.id, "S03", "Ha", 500);
  const unreviewed = await record(rosa.id, "S04", "Ndaje", 2000);
  for (const t of [a, b, c, short]) await reviewTake(t.narrationId, "approved");
  await selectTake(a.narrationId);

  const dry = await exportDataset({ profileKey: "rosa", language: "gn", dryRun: true });
  assert.equal(dry.clips, 2);
  assert.equal(dry.folder, null);
  assert.deepEqual(
    dry.excluded.map((e) => [e.id, e.reason]),
    [[short.narrationId, "too_short"]],
  );
  assert.equal(existsSync(path.join(root, "voice", "_datasets")), false);

  const s = await exportDataset({
    profileKey: "rosa",
    language: "gn",
    now: new Date(2026, 9, 7, 9, 5),
  });
  assert.equal(s.folder, "voice/_datasets/rosa-gn-20261007-0905");
  const dir = path.join(root, s.folder!);
  const wavs = readdirSync(path.join(dir, "wavs")).sort();
  assert.deepEqual(wavs, [`take${a.narrationId}.wav`, `take${c.narrationId}.wav`].sort());
  // No temp folder left behind.
  assert.deepEqual(readdirSync(path.join(root, "voice", "_datasets")), ["rosa-gn-20261007-0905"]);

  const probe = spawnSync(process.env.FFPROBE_PATH || "ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=sample_rate,channels,codec_name",
    "-of",
    "json",
    path.join(dir, "wavs", wavs[0]),
  ]);
  const stream = JSON.parse(String(probe.stdout)).streams[0];
  assert.equal(stream.sample_rate, "22050");
  assert.equal(stream.channels, 1);
  assert.equal(stream.codec_name, "pcm_s16le");

  const csv = readFileSync(path.join(dir, "metadata.csv"), "utf8");
  const lines = csv.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.ok(
    lines.includes(`take${a.narrationId}|Che ra'y, ãga reg̃uahẽ / ỹ|Che ra'y, ãga reg̃uahẽ / ỹ`),
  );
  assert.ok(lines.includes(`take${c.narrationId}|Mbohapy mymba|Mbohapy mymba`));

  const meta = JSON.parse(readFileSync(path.join(dir, "dataset.json"), "utf8"));
  assert.equal(meta.sampleRate, 22_050);
  assert.equal(meta.clipCount, 2);
  assert.deepEqual([...meta.sourceTakeIds].sort(), [a.narrationId, c.narrationId].sort());
  assert.ok(meta.totalSeconds > 3 && meta.totalSeconds < 4.5, `total ${meta.totalSeconds}`);
  assert.equal(meta.options.includeUnreviewed, false);
  assert.equal(meta.excluded.length, 1);

  const readme = readFileSync(path.join(dir, "README.md"), "utf8");
  assert.match(readme, /Rosa Benítez/);
  assert.match(readme, /AI voice training/);
  assert.match(readme, /docs\/DATASET\.md/);

  const recent = await listExports();
  assert.equal(recent[0].name, "rosa-gn-20261007-0905");
  assert.equal(recent[0].clipCount, 2);

  const overview = await datasetOverview();
  const row = overview.find((r) => r.profileKey === "rosa" && r.language === "gn");
  assert.equal(row?.approvedClips, 2);
  assert.equal(row?.unreviewed, 1);

  const withUnreviewed = await exportDataset({
    profileKey: "rosa",
    language: "gn",
    includeUnreviewed: true,
    dryRun: true,
  });
  assert.equal(withUnreviewed.clips, 3);
  void unreviewed;
});

test("refuses a profile whose consent is pending or revoked", async () => {
  await createProfile({
    key: "nn",
    name: "NN",
    provider: "manual",
    providerVoiceId: null,
    languages: ["gn"],
    consentStatus: "pending",
    consentPerson: "NN",
  });
  await assert.rejects(
    exportDataset({ profileKey: "nn", language: "gn", dryRun: true }),
    DatasetConsentError,
  );
  await assert.rejects(
    exportDataset({ profileKey: "missing", language: "gn" }),
    /No voice profile/,
  );
});
