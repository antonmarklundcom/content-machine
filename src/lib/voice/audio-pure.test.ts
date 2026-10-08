import assert from "node:assert/strict";
import { test } from "node:test";

import { charactersToWords, proportionalWords, restoreWords } from "./alignment";
import { buildSsml, speedToRate, ssmlLang, xmlEscape } from "./ssml";
import { parseWav, pcmToWav, sampleRateFromMime, toneWav } from "./wav";

// --- WAV -------------------------------------------------------------------

test("pcmToWav writes a canonical header that parseWav reads back", () => {
  const pcm = Buffer.alloc(48_000); // 1 s of 24 kHz s16 mono
  const wav = pcmToWav(pcm, 24_000);
  assert.equal(wav.length, 44 + pcm.length);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(4), 36 + pcm.length);
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt32LE(28), 48_000); // byte rate
  const info = parseWav(wav);
  assert.deepEqual(info, {
    sampleRate: 24_000,
    channels: 1,
    bitsPerSample: 16,
    dataOffset: 44,
    dataLength: 48_000,
    durationMs: 1000,
  });
});

test("parseWav walks extra chunks and tolerates a streamed (unknown) data size", () => {
  const pcm = Buffer.alloc(44_100 * 2);
  const plain = pcmToWav(pcm, 44_100);
  const list = Buffer.concat([Buffer.from("LIST"), Buffer.from([4, 0, 0, 0]), Buffer.from("INFO")]);
  const withList = Buffer.concat([plain.subarray(0, 36), list, plain.subarray(36)]);
  withList.writeUInt32LE(0xffffffff, 36 + list.length + 4);
  const info = parseWav(withList);
  assert.equal(info?.durationMs, 1000);
  assert.equal(info?.dataOffset, 44 + list.length);
  assert.equal(parseWav(Buffer.from("not a wav file at all")), null);
});

test("toneWav length follows the duration; noise makes two takes differ", () => {
  const a = toneWav({ durationMs: 500, sampleRate: 16_000, noise: true });
  const b = toneWav({ durationMs: 500, sampleRate: 16_000, noise: true });
  assert.equal(parseWav(a)?.durationMs, 500);
  assert.notDeepEqual(a, b);
  assert.deepEqual(toneWav({ durationMs: 100 }), toneWav({ durationMs: 100 }));
});

test("sampleRateFromMime reads Gemini's L16 mime type", () => {
  assert.equal(sampleRateFromMime("audio/L16;codec=pcm;rate=24000"), 24_000);
  assert.equal(sampleRateFromMime("audio/L16"), 24_000);
  assert.equal(sampleRateFromMime(undefined, 16_000), 16_000);
});

// --- alignment -------------------------------------------------------------

test("ElevenLabs characters become words with ms timings", () => {
  const text = "Hola, che ra'a";
  const characters = [...text];
  const starts = characters.map((_, i) => i * 0.1);
  const ends = characters.map((_, i) => i * 0.1 + 0.08);
  const words = charactersToWords({
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  });
  assert.deepEqual(words, [
    { word: "Hola,", startMs: 0, endMs: 480 },
    { word: "che", startMs: 600, endMs: 880 },
    { word: "ra'a", startMs: 1000, endMs: 1380 },
  ]);
});

test("charactersToWords handles leading/trailing/multiple spaces and empty input", () => {
  const characters = [" ", "a", " ", " ", "b", " "];
  const t = characters.map((_, i) => i);
  assert.deepEqual(
    charactersToWords({
      characters,
      character_start_times_seconds: t,
      character_end_times_seconds: t,
    }),
    [
      { word: "a", startMs: 1000, endMs: 1000 },
      { word: "b", startMs: 4000, endMs: 4000 },
    ],
  );
  assert.deepEqual(charactersToWords(null), []);
});

test("restoreWords puts the written words back when the counts match", () => {
  const spoken = [
    { word: "Ipacaraí", startMs: 0, endMs: 500 },
    { word: "lindo", startMs: 600, endMs: 900 },
  ];
  assert.deepEqual(
    restoreWords(spoken, "Ypacaraí lindo").map((w) => w.word),
    ["Ypacaraí", "lindo"],
  );
  assert.equal(restoreWords(spoken, "one two three"), spoken);
});

test("proportionalWords spans the duration in order", () => {
  const words = proportionalWords("uno dos tres", 1200);
  assert.equal(words.length, 3);
  assert.ok(words.every((w, i) => i === 0 || w.startMs >= words[i - 1].endMs));
  assert.ok(words[2].endMs <= 1200);
});

// --- SSML ------------------------------------------------------------------

test("xmlEscape escapes the five XML characters", () => {
  assert.equal(xmlEscape(`<a & "b" 'c'>`), "&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;");
});

test("buildSsml: es-PY voice, style, prosody, escaped text", () => {
  const ssml = buildSsml({
    text: "Che ra'a & <vos> sabés",
    voiceName: "es-PY-TaniaNeural",
    language: "jopara",
    style: "cheerful",
    speed: 0.9,
    pitch: "-2%",
  });
  assert.equal(
    ssml,
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="es-PY">' +
      '<voice name="es-PY-TaniaNeural"><mstts:express-as style="cheerful"><prosody rate="-10%" pitch="-2%">' +
      "Che ra&apos;a &amp; &lt;vos&gt; sabés</prosody></mstts:express-as></voice></speak>",
  );
});

test("buildSsml drops an invalid style/pitch and omits prosody at speed 1", () => {
  const ssml = buildSsml({
    text: "hola",
    voiceName: "es-PY-MarioNeural",
    language: "es-PY",
    style: 'x" onload="',
    pitch: "loud!",
    speed: 1,
  });
  assert.ok(!ssml.includes("express-as"));
  assert.ok(!ssml.includes("prosody"));
  assert.ok(ssml.includes('<voice name="es-PY-MarioNeural">hola</voice>'));
});

test("ssmlLang and speedToRate", () => {
  assert.equal(ssmlLang("es-PY-TaniaNeural", "en"), "es-PY");
  assert.equal(ssmlLang("custom", "jopara"), "es-PY");
  assert.equal(ssmlLang("custom", "sv"), "sv-SE");
  assert.equal(speedToRate(1.1), "+10%");
  assert.equal(speedToRate(1), null);
  assert.equal(speedToRate(undefined), null);
});
