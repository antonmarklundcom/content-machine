import assert from "node:assert/strict";
import { test } from "node:test";

import { StreamParser } from "./stream";
import { downloadCommand } from "./prompt";
import {
  buildVoiceRunPrompt,
  creditsPerMinute,
  engineSpeaks,
  estimateLineCredits,
  HiggsfieldVoiceSettingsError,
  manifestEstimate,
  parseVoiceManifest,
  resolveHiggsfieldSettings,
  scanVoiceMarkers,
  splitCredits,
  voiceArgument,
  VoiceMarkerCollector,
  voiceOutFile,
  type VoiceManifest,
} from "./voice";

const chars = (n: number) => "a".repeat(n);

test("estimates scale the measured per-minute prices by characters", () => {
  assert.equal(estimateLineCredits(chars(950), "text2speech_v2", "elevenlabs"), 2.7);
  assert.equal(estimateLineCredits(chars(950), "text2speech_v2", "minimax"), 2.7);
  assert.equal(estimateLineCredits(chars(475), "text2speech_v2", "elevenlabs"), 1.35);
  assert.equal(estimateLineCredits(chars(950), "elevenlabs_v4"), 4.14);
  assert.equal(estimateLineCredits(chars(1900), "seed_audio"), 11.8);
  assert.equal(estimateLineCredits(chars(950), "qwen_audio_tts"), 0.38);
  // Unmeasured engines err high; a tiny line still costs something; empty costs nothing.
  assert.deepEqual(creditsPerMinute("text2speech_v2", "cozy_voice"), {
    credits: 5.9,
    measured: false,
  });
  assert.equal(creditsPerMinute("elevenlabs_v4_turbo").credits, 4.14);
  assert.equal(estimateLineCredits("Hola", "qwen_audio_tts"), 0.01);
  assert.equal(estimateLineCredits("   ", "seed_audio"), 0);
  assert.equal(manifestEstimate([{ estimateCredits: 1.1 }, { estimateCredits: 2.25 }]), 3.35);
});

test("no engine speaks Guaraní; qwen has no Spanish", () => {
  assert.equal(engineSpeaks("text2speech_v2", "gn"), false);
  assert.equal(engineSpeaks("text2speech_v2", "es-PY"), true);
  assert.equal(engineSpeaks("qwen_audio_tts", "es-PY"), false);
  assert.equal(engineSpeaks("qwen_audio_tts", "jopara"), false);
  assert.equal(engineSpeaks("qwen_audio_tts", "en"), true);
});

test("profile settings: model, variant for text2speech_v2, voice type and id", () => {
  assert.deepEqual(
    resolveHiggsfieldSettings({
      higgsfield: {
        model: "text2speech_v2",
        variant: "minimax",
        voiceType: "preset",
        voiceId: "v1",
      },
    }),
    { model: "text2speech_v2", variant: "minimax", voiceType: "preset", voiceId: "v1" },
  );
  // The voice id falls back to providerVoiceId; a variant is dropped for other models.
  assert.deepEqual(
    resolveHiggsfieldSettings(
      { higgsfield: { model: "elevenlabs_v4", variant: "minimax", voiceType: "element" } },
      "el-9",
    ),
    { model: "elevenlabs_v4", voiceType: "element", voiceId: "el-9" },
  );
  assert.throws(() => resolveHiggsfieldSettings({}), HiggsfieldVoiceSettingsError);
  assert.throws(
    () =>
      resolveHiggsfieldSettings({
        higgsfield: { model: "text2speech_v2", voiceType: "preset", voiceId: "v" },
      }),
    /variant/,
  );
  assert.throws(
    () => resolveHiggsfieldSettings({ higgsfield: { model: "seed_audio", voiceId: "v" } }),
    /voice type/,
  );
  assert.throws(
    () => resolveHiggsfieldSettings({ higgsfield: { model: "seed_audio", voiceType: "preset" } }),
    /list_voices/,
  );
});

test("out files sit next to the take, .wav for seed_audio", () => {
  assert.equal(
    voiceOutFile("voice/free/x/_all/es-PY", 7, "seed_audio"),
    "voice/free/x/_all/es-PY/take-7.hf.wav",
  );
  assert.equal(voiceOutFile("v", 8, "text2speech_v2"), "v/take-8.hf.mp3");
});

const manifest: VoiceManifest = {
  jobRef: null,
  ceilingCredits: 3,
  lines: [
    {
      lineId: 41,
      model: "text2speech_v2",
      variant: "elevenlabs",
      voiceType: "preset",
      voiceId: "v1",
      text: 'Tito dijo: "¡salto!"\n```',
      outFile: "voice/a/take-41.hf.mp3",
      estimateCredits: 0.1,
    },
  ],
};

test("the run prompt carries the manifest, job ref, ceiling and the voice HF lines", () => {
  const prompt = buildVoiceRunPrompt({
    jobId: 9,
    argument: voiceArgument(manifest),
    maxCredits: 5,
    mediaRoot: "E:\\ContentEngine",
  });
  assert.ok(prompt.startsWith("/higgsfield-voice ```json\n"));
  const parsed = parseVoiceManifest(prompt);
  assert.ok(parsed);
  assert.equal(parsed.jobRef, "content-engine job #9");
  assert.equal(parsed.ceilingCredits, 5);
  assert.deepEqual(parsed.lines, manifest.lines);
  assert.ok(
    prompt.includes("Spend at most 5 credits: check balance first, preflight with get_cost"),
  );
  assert.ok(prompt.includes("HF_JOB <lineId> <higgsfield job id>"));
  assert.ok(prompt.includes("HF_FAIL <lineId> <short reason>"));
  assert.ok(prompt.includes(`${downloadCommand("E:/ContentEngine")} "<outFile>"`));
  assert.ok(prompt.includes("## Run rules (content-engine job #9, headless)"));
  assert.equal(parseVoiceManifest("no manifest"), null);
  assert.throws(() =>
    buildVoiceRunPrompt({ jobId: 1, argument: "x", maxCredits: 1, mediaRoot: "/m" }),
  );
});

test("HF lines: line-id job form, the old one-token form, failures, files, credits", () => {
  const m = scanVoiceMarkers(
    [
      "HF_BALANCE before 100",
      "HF_JOB 41 3f9a-abc",
      "- HF_JOB 42 `77aa`",
      "HF_JOB lonely-id",
      "HF_FILE voice/a/take-41.hf.mp3",
      "HF_FAIL 42 voice id not found",
      "HF_FAIL nonsense",
      "HF_CREDITS 3,5",
    ].join("\n"),
  );
  assert.deepEqual(m.jobs, { 41: "3f9a-abc", 42: "77aa" });
  assert.deepEqual(m.jobIds, ["3f9a-abc", "77aa", "lonely-id"]);
  assert.deepEqual(m.failures, { 42: "voice id not found" });
  assert.deepEqual(m.files, ["voice/a/take-41.hf.mp3"]);
  assert.equal(m.credits, 3.5);
});

test("the collector reads HF lines out of stream-json, split anywhere", () => {
  const events = [
    { type: "system", subtype: "init", mcp_servers: [] },
    {
      type: "assistant",
      message: { content: [{ type: "text", text: "HF_JOB 5 job-5\nHF_FILE x/take-5.hf.mp3" }] },
    },
    { type: "result", subtype: "success", is_error: false, result: "Done\nHF_CREDITS 2" },
  ];
  const raw = events.map((e) => JSON.stringify(e)).join("\n");
  const c = new VoiceMarkerCollector();
  for (let i = 0; i < raw.length; i += 17) c.feed(raw.slice(i, i + 17));
  c.end();
  assert.deepEqual(c.markers.jobs, { 5: "job-5" });
  assert.deepEqual(c.markers.files, ["x/take-5.hf.mp3"]);
  assert.equal(c.markers.credits, 2);

  // The generic parser keeps working on voice output (files, credits; HF_FAIL is ignored).
  const p = new StreamParser("/m");
  p.feed(
    `${raw}\n${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "HF_FAIL 5 boom" }] } })}\n`,
  );
  assert.deepEqual(p.state.outputPaths, ["x/take-5.hf.mp3"]);
  assert.equal(p.state.creditsUsed, 2);
});

test("credits are split by characters over the lines that made a take", () => {
  const shares = splitCredits(3, [
    { lineId: 1, text: chars(100) },
    { lineId: 2, text: chars(200) },
  ]);
  assert.equal(shares.get(1), 1);
  assert.equal(shares.get(2), 2);
  assert.equal(splitCredits(null, [{ lineId: 1, text: "x" }]).get(1), null);
});
