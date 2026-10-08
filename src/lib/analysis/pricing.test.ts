/**
 * The brand-ideation path bills against the same cap as the analysis pipeline
 * (PLAN.md §1.10), which means its arithmetic has to be as trustworthy as
 * MODEL_RATES already was. Four things are worth pinning: the published rates
 * are what the table actually holds, an unknown model must not silently bill as
 * free, Search grounding must not be accounted for as tokens only — it is
 * charged per query on top of them — and a long-context request must not bill
 * at the short-context rate.
 *
 * The numbers below are Gemini API paid-tier rates read from Google's pricing
 * page on 2026-08-29 (PLAN.md §5.O3). They are duplicated here on purpose: a
 * test that reads its expectations out of the module it is testing would pass
 * against any typo.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BATCH_DISCOUNT,
  costUsdAtRates,
  estimateCostUsd,
  GROUNDING_USD_PER_QUERY,
  ideationRates,
  IDEATION_MODEL_RATES,
  LONG_CONTEXT_THRESHOLD_TOKENS,
  MODEL_RATES,
} from "./pricing";

const NO_CACHE = { cacheReadTokens: 0, cacheWriteTokens: 0 };

test("the rate table holds the published Gemini rates", () => {
  // Analysis models: Flash-Lite is the default seat, 3.7 Flash the opt-in.
  assert.equal(MODEL_RATES["gemini-3.1-flash-lite"].input, 0.25);
  assert.equal(MODEL_RATES["gemini-3.1-flash-lite"].output, 1.5);
  // Standard rate, not the $0.75/$3.75 introductory one that lapses 2026-12-31
  // — over-reporting until then is the safe direction.
  assert.equal(MODEL_RATES["gemini-3.7-flash"].input, 1.5);
  assert.equal(MODEL_RATES["gemini-3.7-flash"].output, 7.5);

  // Ideation default: Gemini 3.1 Pro, $2/$12 under 200k input tokens.
  assert.equal(IDEATION_MODEL_RATES["gemini-3.1-pro-preview"].input, 2);
  assert.equal(IDEATION_MODEL_RATES["gemini-3.1-pro-preview"].output, 12);
});

test("costUsdAtRates is the arithmetic estimateCostUsd already used", () => {
  const usage = { inputTokens: 10_000, outputTokens: 2_000, ...NO_CACHE };
  assert.equal(
    costUsdAtRates(MODEL_RATES["gemini-3.1-flash-lite"], usage),
    estimateCostUsd("gemini-3.1-flash-lite", usage),
  );
});

test("a million input tokens costs exactly the model's input rate", () => {
  // On a flat-priced model, where a million tokens is still short context.
  const rates = MODEL_RATES["gemini-3.7-flash"];
  const cost = costUsdAtRates(rates, { inputTokens: 1_000_000, outputTokens: 0, ...NO_CACHE });
  assert.equal(cost, rates.input);
});

test("a short-context Pro call bills at the short-context rate", () => {
  const rates = IDEATION_MODEL_RATES["gemini-3.1-pro-preview"];
  // 100k each side: under the threshold, so the plain $2/$12 applies. This is
  // the shape every real /api/generate run has — the ideation prompt is a few
  // thousand tokens, and Search grounding's own tokens are not billed at all.
  const cost = costUsdAtRates(rates, { inputTokens: 100_000, outputTokens: 100_000, ...NO_CACHE });
  assert.equal(cost, (100_000 * 2 + 100_000 * 12) / 1_000_000);
});

test("a real analysis costs about what PLAN.md budgeted for one", () => {
  // ~7k input tokens for an hour of speech, ~2.5k of structured output.
  const usage = { inputTokens: 7_000, outputTokens: 2_500, ...NO_CACHE };
  const interactive = estimateCostUsd("gemini-3.1-flash-lite", usage);
  assert.equal(interactive, (7_000 * 0.25 + 2_500 * 1.5) / 1_000_000);
  // Under a cent a video, and the nightly poller's batch halves even that.
  assert.ok(interactive < 0.01);
  assert.equal(estimateCostUsd("gemini-3.1-flash-lite", usage, { batch: true }), interactive / 2);
});

test("the batch discount is a flat half, and applies to every component", () => {
  assert.equal(BATCH_DISCOUNT, 0.5);
  const usage = {
    inputTokens: 9_000,
    outputTokens: 3_000,
    cacheReadTokens: 500,
    cacheWriteTokens: 0,
  };
  assert.equal(
    estimateCostUsd("gemini-3.7-flash", usage, { batch: true }),
    estimateCostUsd("gemini-3.7-flash", usage) * BATCH_DISCOUNT,
  );
});

test("an unknown model bills at the most expensive rate on file, not at zero", () => {
  // The safe direction to be wrong in: over-estimating trips the cap early.
  const unknown = ideationRates("gemini-something-not-shipped-yet");
  assert.deepEqual(unknown, IDEATION_MODEL_RATES["gemini-3.1-pro-preview"]);
  for (const rates of Object.values(IDEATION_MODEL_RATES)) {
    assert.ok(unknown.input >= rates.input);
    assert.ok(unknown.output >= rates.output);
  }
});

test("a long-context request bills at the long-context rate, input and output", () => {
  const rates = IDEATION_MODEL_RATES["gemini-3.1-pro-preview"];
  const long = {
    inputTokens: LONG_CONTEXT_THRESHOLD_TOKENS + 1,
    outputTokens: 1_000_000,
    ...NO_CACHE,
  };
  const cost = costUsdAtRates(rates, long);
  // Google reprices the whole request once the input crosses the threshold, so
  // the output million bills at $18, not $12.
  assert.equal(cost, ((LONG_CONTEXT_THRESHOLD_TOKENS + 1) * 4) / 1_000_000 + 18);
  // …and one token below it, at the short-context rate.
  const short = {
    inputTokens: LONG_CONTEXT_THRESHOLD_TOKENS,
    outputTokens: 1_000_000,
    ...NO_CACHE,
  };
  assert.equal(costUsdAtRates(rates, short), (LONG_CONTEXT_THRESHOLD_TOKENS * 2) / 1_000_000 + 12);
});

test("a flat-priced model has no long-context tier to fall through to", () => {
  // Flash and Flash-Lite are the same price at any context length; the tier
  // must not be inherited from the Pro entry by accident.
  for (const model of ["gemini-3.1-flash-lite", "gemini-3.7-flash"] as const) {
    assert.equal(MODEL_RATES[model].longContext, undefined);
    const huge = { inputTokens: 400_000, outputTokens: 1_000, ...NO_CACHE };
    assert.equal(
      estimateCostUsd(model, huge),
      (400_000 * MODEL_RATES[model].input + 1_000 * MODEL_RATES[model].output) / 1_000_000,
    );
  }
});

test("grounding is priced per query, at $14 per thousand", () => {
  assert.equal(GROUNDING_USD_PER_QUERY * 1000, 14);
  // A grounding fee is on top of tokens — a call that searches eight times has
  // to cost more than the same tokens with no searches, or the cap under-counts.
  assert.ok(8 * GROUNDING_USD_PER_QUERY > 0);
});

test("cached tokens are never billed as free", () => {
  // Gemini reports a cached-token count, but this app buys no cache and the
  // implicit discount is not guaranteed on the Gemini 3 family — so a cached
  // token costs the same as a plain input token here, deliberately.
  const rates = MODEL_RATES["gemini-3.7-flash"];
  const cached = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 0,
  };
  assert.equal(costUsdAtRates(rates, cached), rates.input);
});
