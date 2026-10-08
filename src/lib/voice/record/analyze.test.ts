import assert from "node:assert/strict";
import { test } from "node:test";

import {
  analyzeTake,
  expectedDurationMs,
  extensionFor,
  levelOf,
  meterFraction,
  mixDown,
  pickMimeType,
  toDb,
} from "./analyze";

const RATE = 16000;

/** silence (ms) + a sine at `amp` (ms) + silence (ms). */
function signal(leadMs: number, toneMs: number, tailMs: number, amp = 0.3): Float32Array {
  const n = (ms: number) => Math.round((ms / 1000) * RATE);
  const out = new Float32Array(n(leadMs) + n(toneMs) + n(tailMs));
  const start = n(leadMs);
  for (let i = 0; i < n(toneMs); i++)
    out[start + i] = amp * Math.sin((2 * Math.PI * 220 * i) / RATE);
  return out;
}

// "Tito salta muy alto." = 16 letters → ~1.2 s at 13 chars/s.
const LINE = "Tito salta muy alto.";

test("a clean take: no warnings, measured peak, edges and duration", () => {
  const a = analyzeTake(signal(400, 1500, 500), RATE, LINE);
  assert.deepEqual(a.warnings, []);
  assert.equal(a.durationMs, 2400);
  assert.ok(Math.abs(a.peakDb - toDb(0.3)) < 0.1);
  assert.ok(Math.abs(a.leadingSilenceMs - 400) <= 10, `lead ${a.leadingSilenceMs}`);
  assert.ok(Math.abs(a.trailingSilenceMs - 500) <= 10, `tail ${a.trailingSilenceMs}`);
  assert.equal(a.clippedSamples, 0);
  assert.equal(a.expectedMs, expectedDurationMs(LINE));
});

test("clipping: a few overshoots are tolerated, a squared-off take warns", () => {
  const ok = signal(300, 1500, 300);
  ok[RATE] = 1;
  assert.ok(!analyzeTake(ok, RATE, LINE).warnings.includes("clipping"));
  const hot = signal(300, 1500, 300, 1.4).map((v) => Math.max(-1, Math.min(1, v)));
  const a = analyzeTake(hot, RATE, LINE);
  assert.ok(a.warnings.includes("clipping"));
  assert.ok(a.clippedSamples > 100);
});

test("quiet and silent takes", () => {
  assert.ok(analyzeTake(signal(300, 1500, 300, 0.03), RATE, LINE).warnings.includes("quiet"));
  const silent = analyzeTake(new Float32Array(RATE * 2), RATE, LINE);
  assert.ok(silent.warnings.includes("silent"));
  assert.ok(silent.warnings.includes("too_short"));
  assert.equal(silent.peakDb, -Infinity);
  assert.ok(!silent.warnings.includes("start_cut"), "edges are not judged on silence");
});

test("leading/trailing silence: cut-off edges and dead air", () => {
  const cut = analyzeTake(signal(0, 1500, 0), RATE, LINE);
  assert.ok(cut.warnings.includes("start_cut"));
  assert.ok(cut.warnings.includes("end_cut"));
  const air = analyzeTake(signal(3000, 1500, 2500), RATE, LINE);
  assert.ok(air.warnings.includes("long_lead"));
  assert.ok(air.warnings.includes("long_tail"));
  assert.ok(!air.warnings.includes("too_long"), "dead air is not counted as speech");
});

test("very short or very long for the text", () => {
  assert.ok(analyzeTake(signal(300, 200, 300), RATE, LINE).warnings.includes("too_short"));
  assert.ok(analyzeTake(signal(300, 9000, 300), RATE, LINE).warnings.includes("too_long"));
  // Without text there is nothing to compare with.
  const none = analyzeTake(signal(300, 200, 300), RATE, null);
  assert.equal(none.expectedMs, null);
  assert.ok(!none.warnings.includes("too_short"));
});

test("expected duration counts letters, Guaraní included", () => {
  assert.equal(expectedDurationMs(""), 0);
  assert.equal(expectedDurationMs("ñandutí"), Math.round((7 / 13) * 1000));
  // g̃ is g + U+0303: the combining mark is not a letter.
  assert.equal(expectedDurationMs("g̃uahẽ"), Math.round((5 / 13) * 1000));
});

test("meter helpers, mixdown, recorder container", () => {
  const { peak, rms } = levelOf([0.5, -0.5, 0.5, -0.5]);
  assert.equal(peak, 0.5);
  assert.equal(rms, 0.5);
  assert.deepEqual(levelOf([]), { peak: 0, rms: 0 });
  assert.equal(meterFraction(1), 1);
  assert.equal(meterFraction(0), 0);
  assert.ok(Math.abs(meterFraction(10 ** (-30 / 20)) - 0.5) < 1e-9, "−30 dBFS is mid-scale");
  assert.equal(meterFraction(0.0001), 0, "below the floor");
  assert.deepEqual(
    Array.from(mixDown([new Float32Array([1, 0]), new Float32Array([0, 1])])),
    [0.5, 0.5],
  );
  assert.equal(mixDown([]).length, 0);
  assert.equal(
    pickMimeType((t) => t === "audio/webm;codecs=opus" || t === "audio/mp4"),
    "audio/webm;codecs=opus",
  );
  assert.equal(
    pickMimeType((t) => t === "audio/mp4"),
    "audio/mp4",
  );
  assert.equal(
    pickMimeType(() => false),
    null,
  );
  assert.equal(extensionFor("audio/webm;codecs=opus"), "webm");
  assert.equal(extensionFor("audio/ogg;codecs=opus"), "ogg");
  assert.equal(extensionFor("audio/mp4"), "m4a");
});
