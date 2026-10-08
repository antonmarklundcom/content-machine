/**
 * The provider swap (PLAN.md §5.O3) moved the riskiest arithmetic in the app:
 * how a response's own counters become the number written to `spend_log`.
 * Gemini reports usage in a different shape from the Anthropic fields this
 * replaced, and every one of the differences errs towards under-reporting if it
 * is missed — which is the one failure the spend cap cannot survive.
 *
 * These pin the mapping. No network and no database: `readUsage` and
 * `messageCostUsd` are pure, which is why they are separate from the call that
 * uses them.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { GenerateContentResponse } from "@google/genai";
import { groundingQueryCount, messageCostUsd, readUsage, responseText } from "./ai";
import { GROUNDING_USD_PER_QUERY, IDEATION_MODEL_RATES } from "./analysis/pricing";

/** Just enough of a response to price it. */
function response(parts: {
  promptTokenCount?: number;
  cachedContentTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
  webSearchQueries?: string[];
}): GenerateContentResponse {
  const { webSearchQueries, ...usageMetadata } = parts;
  return {
    usageMetadata,
    candidates: webSearchQueries ? [{ groundingMetadata: { webSearchQueries } }] : [],
  } as unknown as GenerateContentResponse;
}

test("reasoning tokens are billed — they are not part of candidatesTokenCount", () => {
  // The single most expensive thing to get wrong: a thinking model can spend
  // more on thoughts than on the answer, and Gemini reports them separately.
  const usage = readUsage(
    response({ promptTokenCount: 1_000, candidatesTokenCount: 500, thoughtsTokenCount: 4_000 }),
  );
  assert.equal(usage.outputTokens, 4_500);
  assert.equal(usage.inputTokens, 1_000);
});

test("cached tokens are not billed twice — promptTokenCount already includes them", () => {
  // Anthropic's input_tokens excluded the cached prefix; Gemini's includes it.
  // Carrying the old assumption over would bill the cached half at ~2x.
  const usage = readUsage(
    response({ promptTokenCount: 10_000, cachedContentTokenCount: 4_000, candidatesTokenCount: 0 }),
  );
  assert.equal(usage.inputTokens, 6_000);
  assert.equal(usage.cacheReadTokens, 4_000);
  // Full prompt size is still recoverable from the stored row.
  assert.equal(usage.inputTokens + usage.cacheReadTokens, 10_000);
});

test("Search grounding's own tokens are not billed as input", () => {
  // Google does not charge for the tokens grounding feeds back into the
  // prompt — they are billed per query instead. Counting them would inflate a
  // grounded run by tens of thousands of tokens it never paid for.
  const usage = readUsage(
    response({
      promptTokenCount: 2_000,
      toolUsePromptTokenCount: 48_000,
      candidatesTokenCount: 3_000,
    }),
  );
  assert.equal(usage.inputTokens, 2_000);
});

test("missing or incomplete billing metadata stays unknown; explicit zero is valid", () => {
  assert.throws(() => readUsage({} as GenerateContentResponse), /billing metadata/);
  assert.throws(() => readUsage(response({ promptTokenCount: 100 })), /billing metadata/);
  assert.deepEqual(readUsage(response({ promptTokenCount: 0, candidatesTokenCount: 0 })), {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  const odd = readUsage(
    response({ promptTokenCount: 100, candidatesTokenCount: 0, cachedContentTokenCount: 500 }),
  );
  assert.equal(odd.inputTokens, 0);
});

test("Gemini reports no cache-write tokens, so that bucket stays zero", () => {
  const usage = readUsage(
    response({ promptTokenCount: 9_000, candidatesTokenCount: 0, cachedContentTokenCount: 8_000 }),
  );
  assert.equal(usage.cacheWriteTokens, 0);
});

test("grounding queries are counted from the response, not assumed", () => {
  assert.equal(groundingQueryCount(response({ webSearchQueries: ["a", "b", "c"] })), 3);
  // A call that grounded nothing pays nothing for grounding — which is what
  // lets the promote path share the same cost function.
  assert.equal(groundingQueryCount(response({ promptTokenCount: 10 })), 0);
});

test("a grounded call costs its tokens plus its queries", () => {
  const model = "gemini-3.1-pro-preview";
  const rates = IDEATION_MODEL_RATES[model];
  const res = response({
    promptTokenCount: 4_000,
    candidatesTokenCount: 6_000,
    thoughtsTokenCount: 2_000,
    webSearchQueries: ["one", "two", "three", "four"],
  });
  const cost = messageCostUsd(readUsage(res), groundingQueryCount(res), model);

  const tokens = (4_000 * rates.input + 8_000 * rates.output) / 1_000_000;
  assert.equal(cost, tokens + 4 * GROUNDING_USD_PER_QUERY);
  // The fee is on top of tokens, not instead of them.
  assert.ok(cost > tokens);
});

test("an unknown GEMINI_MODEL bills at the Pro rate rather than free", () => {
  const usage = {
    inputTokens: 1_000,
    outputTokens: 1_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  assert.equal(
    messageCostUsd(usage, 0, "gemini-not-shipped-yet"),
    messageCostUsd(usage, 0, "gemini-3.1-pro-preview"),
  );
});

test("responseText survives a response that lost its prototype", () => {
  // Batch results arrive as JSON, so the `.text` getter may simply not be
  // there. Reading an empty string would mark every analysis in the batch
  // failed while still billing for it.
  const plain = {
    candidates: [
      {
        content: {
          parts: [
            { text: "thinking out loud", thought: true },
            { text: '{"summary":' },
            { text: '"ok"}' },
          ],
        },
      },
    ],
  } as unknown as GenerateContentResponse;
  assert.equal(responseText(plain), '{"summary":"ok"}');
  // Nothing at all is an empty string, not a crash.
  assert.equal(responseText({} as GenerateContentResponse), "");
});
