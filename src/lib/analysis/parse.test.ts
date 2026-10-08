/**
 * Parser tests. The parser is the backstop behind structured outputs, so it
 * only runs when something has already gone wrong — which is exactly when a
 * bug in it is most expensive and least likely to be noticed.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAnalysisResponse } from "./parse";

const VALID = {
  summary: "The video argues X.",
  takeaways: ["A", "B"],
  hook: { technique: "open loop", first_30s: "...", why_it_works: "..." },
  timeline: [{ ts: "00:00", topic: "intro", beat: "poses the question" }],
  gaps: [{ gap: "no data", counter_angle: "show the data" }],
  ideas: [{ title: "T", premise: "P", why_now: "N" }],
};

test("parses a well-formed response", () => {
  const r = parseAnalysisResponse(JSON.stringify(VALID));
  assert.ok(r.ok);
  assert.equal(r.payload.summary, "The video argues X.");
  assert.deepEqual(r.payload.takeaways, ["A", "B"]);
  assert.equal(r.payload.hook.technique, "open loop");
});

test("strips markdown fences the contract forbids", () => {
  const r = parseAnalysisResponse("```json\n" + JSON.stringify(VALID) + "\n```");
  assert.ok(r.ok);
  assert.equal(r.payload.summary, "The video argues X.");
});

test("salvages one object out of surrounding prose", () => {
  // A model that ignored the schema often still emits a valid object wrapped in
  // commentary. Recovering it avoids paying for the video a second time.
  const r = parseAnalysisResponse(
    `Here is the analysis you asked for:\n${JSON.stringify(VALID)}\nHope that helps!`,
  );
  assert.ok(r.ok);
  assert.equal(r.payload.summary, "The video argues X.");
});

test("brace matching is not confused by braces inside strings", () => {
  const tricky = { ...VALID, summary: "It uses a } and a { in quotes" };
  const r = parseAnalysisResponse(`prose ${JSON.stringify(tricky)} more prose`);
  assert.ok(r.ok);
  assert.equal(r.payload.summary, "It uses a } and a { in quotes");
});

test("coerces missing optional sections instead of rejecting the whole analysis", () => {
  // A thinner analysis is worth keeping; discarding a correct summary because
  // `gaps` is absent would mean paying to regenerate all of it.
  const r = parseAnalysisResponse(JSON.stringify({ summary: "S", hook: {} }));
  assert.ok(r.ok);
  assert.equal(r.payload.summary, "S");
  assert.deepEqual(r.payload.gaps, []);
  assert.deepEqual(r.payload.takeaways, []);
  assert.equal(r.payload.hook.technique, "");
});

test("drops malformed array entries but keeps the good ones", () => {
  const r = parseAnalysisResponse(
    JSON.stringify({
      summary: "S",
      takeaways: ["good", 42, null, "also good"],
      ideas: [{ title: "keep", premise: "p", why_now: "n" }, { premise: "no title" }],
    }),
  );
  assert.ok(r.ok);
  assert.deepEqual(r.payload.takeaways, ["good", "also good"]);
  assert.equal(r.payload.ideas.length, 1);
  assert.equal(r.payload.ideas[0]?.title, "keep");
});

test("rejects responses with no usable summary", () => {
  // summary is the one field with no meaningful empty value — a row without it
  // is not an analysis, so it must be marked failed rather than stored.
  for (const bad of ["", "not json at all", "[]", JSON.stringify({ takeaways: ["a"] })]) {
    assert.equal(parseAnalysisResponse(bad).ok, false, `should reject: ${bad}`);
  }
});

test("truncated JSON is rejected rather than partially accepted", () => {
  const truncated = JSON.stringify(VALID).slice(0, 60);
  assert.equal(parseAnalysisResponse(truncated).ok, false);
});
