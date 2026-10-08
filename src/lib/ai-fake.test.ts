import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifySchema,
  fakeGeminiEnabled,
  PAYLOADS,
  USAGE,
  validate,
  WEB_SEARCH_QUERIES,
  type FakeResponseKind,
} from "./ai-fake";
import {
  POST_DRAFT_JSON_SCHEMA,
  readUsage,
  SCRIPT_JSON_SCHEMA,
  TITLES_JSON_SCHEMA,
  TRANSCRIPT_JSON_SCHEMA,
} from "./ai";
import { ANALYSIS_JSON_SCHEMA } from "./analysis/prompt";
import { OUTLINE_JSON_SCHEMA } from "./analysis/outline-prompt";
import { SCREENING_JSON_SCHEMA } from "./screening/prompt";
import { LEARN_SUMMARY_JSON_SCHEMA } from "./learn/summarize";
import { REPLY_JSON_SCHEMA } from "./comments/prompt";
import { GAPS_JSON_SCHEMA } from "./gaps/validate";

/**
 * The fake's own guarantees.
 *
 * A test double is only worth what its weakest promise is worth: the moment it
 * answers something the real API could not have, every test standing on it is
 * green for the wrong reason. These are the three promises the integration
 * suite relies on — that a request is classified by its schema, that an
 * unrecognised one is loud, and that the canned payloads really are valid — plus
 * the arithmetic the usage figures were chosen to exercise.
 *
 * Pure: no database, no client, no environment beyond the one env test below.
 */

const KINDS: FakeResponseKind[] = [
  "ideas",
  "adapt",
  "analysis",
  "screening",
  "outline",
  "titles",
  "script",
  "post",
  "transcript",
  "learn",
  "reply",
  "gaps",
];

test("every canned payload validates against the schema it answers", () => {
  // The same check the fake runs per call, but against the repo's real schemas
  // rather than whatever a caller happened to send — so a schema edited in
  // src/lib without touching the fake fails here first.
  const schemas: Record<FakeResponseKind, unknown> = {
    learn: LEARN_SUMMARY_JSON_SCHEMA,
    reply: REPLY_JSON_SCHEMA,
    gaps: GAPS_JSON_SCHEMA,
    ideas: {
      type: "object",
      properties: {
        researchNotes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              topic: { type: "string" },
              summary: { type: "string" },
              sources: { type: "array", items: { type: "string" } },
              relatedBrandIds: { type: "array", items: { type: "string" } },
            },
            required: ["topic", "summary", "sources", "relatedBrandIds"],
          },
        },
        ideas: {
          type: "array",
          minItems: 5,
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              angle: { type: "string" },
              format: { type: "string", enum: ["reel", "carousel", "image_post", "story"] },
              platform: { type: "string" },
              draftCopy: { type: "string" },
              visualNotes: { type: "string" },
              citations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    claim: { type: "string" },
                    sources: { type: "array", items: { type: "string" }, minItems: 2 },
                  },
                  required: ["claim", "sources"],
                },
              },
            },
            required: ["title", "angle", "format", "platform", "draftCopy"],
          },
        },
      },
      required: ["ideas"],
    },
    adapt: {
      type: "object",
      properties: {
        title: { type: "string" },
        angle: { type: "string" },
        draftCopy: { type: "string" },
        visualNotes: { type: "string" },
      },
      required: ["title", "angle", "draftCopy"],
    },
    analysis: ANALYSIS_JSON_SCHEMA,
    screening: SCREENING_JSON_SCHEMA,
    outline: OUTLINE_JSON_SCHEMA,
    titles: TITLES_JSON_SCHEMA,
    script: SCRIPT_JSON_SCHEMA,
    post: POST_DRAFT_JSON_SCHEMA,
    transcript: TRANSCRIPT_JSON_SCHEMA,
  };

  for (const kind of KINDS) {
    assert.doesNotThrow(() => validate(PAYLOADS[kind], schemas[kind]), `${kind} payload`);
    assert.equal(classifySchema(schemas[kind]), kind, `${kind} schema classifies as ${kind}`);
  }
});

test("an unrecognised schema throws rather than answering something", () => {
  // The failure mode this prevents: a new paid call site added by a later phase
  // gets a plausible-looking response, its tests pass, and nothing was tested.
  assert.throws(
    () => classifySchema({ type: "object", properties: { whatever: { type: "string" } } }),
    /no canned response/,
  );
  assert.throws(() => classifySchema(undefined), /no canned response/);
});

test("the validator catches the mistakes a hand-written payload actually makes", () => {
  const schema = {
    type: "object",
    properties: {
      score: { type: "integer", minimum: 0, maximum: 100 },
      tags: { type: "array", minItems: 2, items: { type: "string" } },
      format: { type: "string", enum: ["reel", "story"] },
    },
    required: ["score", "tags"],
    additionalProperties: false,
  };

  assert.doesNotThrow(() => validate({ score: 50, tags: ["a", "b"], format: "reel" }, schema));

  assert.throws(() => validate({ tags: ["a", "b"] }, schema), /missing required property "score"/);
  assert.throws(() => validate({ score: 5.5, tags: ["a", "b"] }, schema), /not an integer/);
  assert.throws(() => validate({ score: 101, tags: ["a", "b"] }, schema), /above maximum/);
  assert.throws(() => validate({ score: -1, tags: ["a", "b"] }, schema), /below minimum/);
  assert.throws(() => validate({ score: 1, tags: ["a"] }, schema), /minimum 2/);
  assert.throws(() => validate({ score: 1, tags: [1, 2] }, schema), /expected a string/);
  assert.throws(
    () => validate({ score: 1, tags: ["a", "b"], format: "essay" }, schema),
    /is not one of/,
  );
  assert.throws(
    () => validate({ score: 1, tags: ["a", "b"], extra: 1 }, schema),
    /not in the schema/,
  );
  assert.throws(() => validate({ score: 1, tags: "a,b" }, schema), /expected an array/);
});

test("the validator names where it failed", () => {
  assert.throws(
    () =>
      validate(
        { ideas: [{ title: "ok" }, { title: 7 }] },
        {
          type: "object",
          properties: {
            ideas: {
              type: "array",
              items: { type: "object", properties: { title: { type: "string" } } },
            },
          },
        },
      ),
    /\$\.ideas\[1\]\.title/,
  );
});

test("the usage figures exercise the arithmetic they were chosen for", () => {
  // A cached prefix that is not subtracted out of promptTokenCount is billed
  // twice; reasoning tokens that are not added to output are not billed at all.
  // Both are silent in production, so at least one canned call has to carry each.
  const analysis = readUsage({ usageMetadata: USAGE.analysis } as never);
  assert.ok(USAGE.analysis.cachedContentTokenCount! > 0, "one call must carry a cached prefix");
  assert.equal(
    analysis.inputTokens,
    USAGE.analysis.promptTokenCount! - USAGE.analysis.cachedContentTokenCount!,
  );
  assert.equal(analysis.cacheReadTokens, USAGE.analysis.cachedContentTokenCount);

  const ideas = readUsage({ usageMetadata: USAGE.ideas } as never);
  assert.ok(USAGE.ideas.thoughtsTokenCount! > 0, "one call must carry reasoning tokens");
  assert.equal(
    ideas.outputTokens,
    USAGE.ideas.candidatesTokenCount! + USAGE.ideas.thoughtsTokenCount!,
  );

  // Gemini has no cache-write counter, so this bucket is always zero.
  for (const kind of KINDS) {
    assert.equal(readUsage({ usageMetadata: USAGE[kind] } as never).cacheWriteTokens, 0);
  }
});

test("a grounded call reports three distinct search queries", () => {
  // Three is a price, not a decoration: $14/1,000 per query, on top of tokens.
  assert.equal(WEB_SEARCH_QUERIES.length, 3);
  assert.equal(
    new Set(WEB_SEARCH_QUERIES).size,
    3,
    "duplicates would make the union assertion vacuous",
  );
});

test("the fake is enabled by the flag, or by a keyless test run", () => {
  const { GEMINI_FAKE, GEMINI_API_KEY, NODE_ENV } = process.env;
  // `NODE_ENV` is typed readonly (Next widens it to a literal union), so the
  // three lines that move it go through a widened view of the same object.
  const env = process.env as Record<string, string | undefined>;
  try {
    delete process.env.GEMINI_FAKE;
    delete process.env.GEMINI_API_KEY;
    env.NODE_ENV = "production";
    assert.equal(fakeGeminiEnabled(), false, "production never answers from canned data");

    process.env.GEMINI_API_KEY = "a-real-looking-key";
    env.NODE_ENV = "test";
    assert.equal(fakeGeminiEnabled(), false, "a test run with a real key is a real run");

    delete process.env.GEMINI_API_KEY;
    assert.equal(fakeGeminiEnabled(), true, "a keyless test run must not reach for a credential");

    env.NODE_ENV = "production";
    process.env.GEMINI_FAKE = "1";
    assert.equal(fakeGeminiEnabled(), true, "the flag is explicit and wins");

    process.env.GEMINI_FAKE = "0";
    assert.equal(fakeGeminiEnabled(), false, 'only "1" turns it on');
  } finally {
    restore("GEMINI_FAKE", GEMINI_FAKE);
    restore("GEMINI_API_KEY", GEMINI_API_KEY);
    restore("NODE_ENV", NODE_ENV);
  }
});

function restore(name: string, value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[name];
  else env[name] = value;
}
