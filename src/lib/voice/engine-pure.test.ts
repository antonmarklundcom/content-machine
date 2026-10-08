import assert from "node:assert/strict";
import { test } from "node:test";

import { NarrationRefusedError } from "./contract";
import {
  AZURE_USD_PER_1K_CHARS,
  billableChars,
  elevenLabsUsdPer1k,
  estimateGeminiTtsUsd,
  estimateTakeUsd,
  geminiTtsUsdFromUsage,
} from "./costs";
import { providerConfigured, voiceFakeEnabled } from "./providers";
import { assertCanSynthesize, pendingReviewMarker, type RefusalProfile } from "./refusals";

// --- costs -----------------------------------------------------------------

test("ElevenLabs: default $0.30/1k chars, env override, bad override ignored", () => {
  assert.equal(elevenLabsUsdPer1k({}), 0.3);
  assert.equal(elevenLabsUsdPer1k({ ELEVENLABS_USD_PER_1K_CHARS: "0.18" }), 0.18);
  assert.equal(elevenLabsUsdPer1k({ ELEVENLABS_USD_PER_1K_CHARS: "cheap" }), 0.3);
  const text = "a".repeat(2000);
  assert.equal(estimateTakeUsd("elevenlabs", text, { env: {} }), 0.6);
  assert.ok(
    Math.abs(
      estimateTakeUsd("elevenlabs", text, { env: { ELEVENLABS_USD_PER_1K_CHARS: "0.1" } }) - 0.2,
    ) < 1e-9,
  );
});

test("Azure is $0.016/1k chars; manual is free; chars are code points", () => {
  assert.equal(AZURE_USD_PER_1K_CHARS, 0.016);
  assert.ok(Math.abs(estimateTakeUsd("azure", "x".repeat(1000)) - 0.016) < 1e-12);
  assert.equal(estimateTakeUsd("manual", "anything"), 0);
  assert.equal(billableChars("g̃ỹ😀"), 4); // g + U+0303, ỹ, one emoji
});

test("Gemini TTS: estimate is token-based and errs above usage for normal speech", () => {
  const text = "Mba'éichapa, ¿cómo andás? ".repeat(30); // ~780 chars
  const estimate = estimateGeminiTtsUsd(text, "Leé con acento paraguayo:");
  // ~780 chars at 14 chars/s ≈ 56 s ≈ 1400 audio tokens; estimate assumes 12 chars/s.
  const typical = geminiTtsUsdFromUsage(220, 1400);
  assert.ok(estimate > typical, `${estimate} should exceed ${typical}`);
  assert.ok(estimate < 0.05);
  assert.equal(
    estimateTakeUsd("gemini", text, { instructions: "Leé con acento paraguayo:" }),
    estimate,
  );
});

// --- refusals --------------------------------------------------------------

const base: RefusalProfile = {
  key: "tania",
  name: "Tania",
  provider: "azure",
  providerVoiceId: "es-PY-TaniaNeural",
  languages: ["es-PY", "jopara"],
  active: true,
  consentStatus: "not_needed",
  consentPerson: null,
  consentExpiresAt: null,
};
const OK = { ok: true } as const;
const NOW = new Date("2026-10-07T12:00:00Z");

function reason(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof NarrationRefusedError, String(error));
    return error.reason;
  }
  return "none";
}

test("empty text refuses", () => {
  assert.equal(
    reason(() => assertCanSynthesize(base, { text: "  \n", language: "es-PY" }, OK, NOW)),
    "empty_text",
  );
});

test("pending-review notices refuse; Spanish 'todo' does not", () => {
  assert.equal(pendingReviewMarker("Lo sabemos todo."), null);
  assert.equal(pendingReviewMarker("Texto [??] aquí"), "[??]");
  assert.equal(pendingReviewMarker("REVISAR: guaraní"), "REVISAR");
  assert.equal(
    reason(() => assertCanSynthesize(base, { text: "Hola TODO", language: "es-PY" }, OK, NOW)),
    "text_not_approved",
  );
  assert.equal(
    reason(() =>
      assertCanSynthesize(base, { text: "Pending review: x", language: "es-PY" }, OK, NOW),
    ),
    "text_not_approved",
  );
});

test("TTS refuses Guaraní, even on a profile that lists it", () => {
  const p = { ...base, languages: ["gn", "es-PY"] };
  assert.equal(
    reason(() => assertCanSynthesize(p, { text: "Mba'éichapa", language: "gn" }, OK, NOW)),
    "language_not_supported",
  );
});

test("a language outside the profile's list refuses", () => {
  assert.equal(
    reason(() => assertCanSynthesize(base, { text: "Hi", language: "en" }, OK, NOW)),
    "language_not_supported",
  );
});

test("consent: pending, revoked and expired refuse; signed and current passes", () => {
  const cloned = {
    ...base,
    provider: "elevenlabs" as const,
    providerVoiceId: "abc",
    consentPerson: "Ana",
  };
  const req = { text: "Hola", language: "es-PY" };
  assert.equal(
    reason(() => assertCanSynthesize({ ...cloned, consentStatus: "pending" }, req, OK, NOW)),
    "consent_missing",
  );
  assert.equal(
    reason(() => assertCanSynthesize({ ...cloned, consentStatus: "revoked" }, req, OK, NOW)),
    "consent_missing",
  );
  assert.equal(
    reason(() =>
      assertCanSynthesize(
        { ...cloned, consentStatus: "signed", consentExpiresAt: new Date("2026-10-01T00:00:00Z") },
        req,
        OK,
        NOW,
      ),
    ),
    "consent_missing",
  );
  assert.equal(
    reason(() =>
      assertCanSynthesize(
        { ...cloned, consentStatus: "signed", consentExpiresAt: new Date("2027-10-01T00:00:00Z") },
        req,
        OK,
        NOW,
      ),
    ),
    "none",
  );
});

test("inactive profile, manual provider, missing voice id and missing key refuse", () => {
  const req = { text: "Hola", language: "es-PY" };
  assert.equal(
    reason(() => assertCanSynthesize({ ...base, active: false }, req, OK, NOW)),
    "provider_not_configured",
  );
  assert.equal(
    reason(() =>
      assertCanSynthesize({ ...base, provider: "manual", providerVoiceId: null }, req, OK, NOW),
    ),
    "provider_not_configured",
  );
  assert.equal(
    reason(() => assertCanSynthesize({ ...base, providerVoiceId: " " }, req, OK, NOW)),
    "provider_not_configured",
  );
  try {
    assertCanSynthesize(base, req, providerConfigured("azure", { VOICE_FAKE: "0" }), NOW);
    assert.fail("should refuse");
  } catch (error) {
    assert.ok(error instanceof NarrationRefusedError);
    assert.equal(error.reason, "provider_not_configured");
    assert.match(error.message, /Azure Speech key \(voice\)/);
  }
});

test("providerConfigured names the Settings field; the fake counts as configured", () => {
  const real = { VOICE_FAKE: "0" };
  assert.deepEqual(providerConfigured("elevenlabs", { ...real, ELEVENLABS_API_KEY: "k" }), {
    ok: true,
  });
  const missing = providerConfigured("elevenlabs", real);
  assert.ok(!missing.ok && /ElevenLabs API key \(voice\)/.test(missing.message));
  const azureHalf = providerConfigured("azure", { ...real, AZURE_SPEECH_KEY: "k" });
  assert.ok(!azureHalf.ok && /region/.test(azureHalf.message));
  const gemini = providerConfigured("gemini", real);
  assert.ok(!gemini.ok && /Gemini API key/.test(gemini.message));
  assert.deepEqual(providerConfigured("manual", real), { ok: true });
  assert.deepEqual(providerConfigured("azure", { VOICE_FAKE: "1" }), { ok: true });
});

test("voiceFakeEnabled", () => {
  assert.equal(voiceFakeEnabled({ VOICE_FAKE: "1" }), true);
  assert.equal(voiceFakeEnabled({ NODE_ENV: "test" }), true);
  assert.equal(voiceFakeEnabled({ GEMINI_FAKE: "1" }), true);
  assert.equal(voiceFakeEnabled({ GEMINI_FAKE: "1", VOICE_FAKE: "0" }), false);
  assert.equal(voiceFakeEnabled({}), false);
});
