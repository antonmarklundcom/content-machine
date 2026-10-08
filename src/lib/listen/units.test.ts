import assert from "node:assert/strict";
import { test } from "node:test";
import { analysisRowUnits, analysisUnits, indexOfUnit, isUnitType, unitKey } from "./units";

const full = {
  summary: "A summary.",
  takeaways: ["First", "Second"],
  hook: { technique: "Cold open", first_30s: "A claim", why_it_works: "Curiosity" },
  timeline: [{ ts: "00:00", topic: "Intro", beat: "Sets the stakes" }],
  gaps: [{ gap: "No numbers", counter_angle: "Show the spreadsheet" }],
  ideas: [{ title: "A video", premise: "About the thing", why_now: "It is August" }],
};

test("reads in contract order: summary, takeaways, hook, timeline, gaps, ideas", () => {
  assert.deepEqual(
    analysisUnits(full).map((u) => u.key),
    ["summary:0", "takeaway:0", "takeaway:1", "hook:0", "timeline:0", "gap:0", "idea:0"],
  );
});

test("multi-field units are one utterance, punctuated so the engine pauses", () => {
  const hook = analysisUnits(full).find((u) => u.type === "hook");
  assert.equal(hook?.text, "Cold open. A claim. Curiosity.");
});

test("the timeline timestamp is not spoken", () => {
  const beat = analysisUnits(full).find((u) => u.type === "timeline");
  assert.equal(beat?.text, "Intro. Sets the stakes.");
  assert.ok(!beat?.text.includes("00:00"));
});

test("existing terminal punctuation is not doubled", () => {
  const units = analysisUnits({ gaps: [{ gap: "Where is the data?", counter_angle: "Show it!" }] });
  assert.equal(units[0]?.text, "Where is the data? Show it!");
});

test("sections the analysis does not have produce no units", () => {
  // A version-1 row (contract.ts) is missing three fields outright, and every
  // JSON column on `analyses` is nullable.
  assert.deepEqual(
    analysisUnits({ summary: "Only this." }).map((u) => u.key),
    ["summary:0"],
  );
  assert.deepEqual(analysisUnits(null), []);
  assert.deepEqual(analysisUnits({}), []);
});

test("an empty section is skipped without renumbering the ones after it", () => {
  // The address is what a PR-37 mark stores. If dropping a blank takeaway
  // shifted the next one down, yesterday's mark would point at new text.
  const units = analysisUnits({ takeaways: ["First", "   ", "Third"] });
  assert.deepEqual(
    units.map((u) => u.key),
    ["takeaway:0", "takeaway:2"],
  );
});

test("whitespace-only fields collapse the whole unit away", () => {
  assert.deepEqual(analysisUnits({ summary: "  \n " }), []);
});

test("indexOfUnit finds a unit's place in the spoken order, or -1", () => {
  const units = analysisUnits(full);
  assert.equal(indexOfUnit(units, "hook", 0), 3);
  assert.equal(indexOfUnit(units, "takeaway", 1), 2);
  assert.equal(indexOfUnit(units, "gap", 9), -1);
});

test("unit keys and type guard agree with each other", () => {
  assert.equal(unitKey("idea", 2), "idea:2");
  assert.ok(isUnitType("timeline"));
  assert.ok(!isUnitType("chapter"));
  assert.ok(!isUnitType(undefined));
});

test("an analyses row's hook_breakdown is read as the contract's hook", () => {
  const units = analysisRowUnits({
    summary: null,
    takeaways: null,
    hookBreakdown: { technique: "Cold open", first_30s: "A claim", why_it_works: "Curiosity" },
    timeline: null,
    gaps: null,
    ideas: null,
  });
  assert.deepEqual(
    units.map((u) => u.key),
    ["hook:0"],
  );
});

test("a row whose JSON columns are all null reads as nothing to listen to", () => {
  assert.deepEqual(
    analysisRowUnits({
      summary: null,
      takeaways: null,
      hookBreakdown: null,
      timeline: null,
      gaps: null,
      ideas: null,
    }),
    [],
  );
});
