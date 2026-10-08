import assert from "node:assert/strict";
import { test } from "node:test";

import { sampleScriptBody } from "@/lib/scripts/fixture";
import type { ScriptBodyV1 } from "@/lib/scripts/contract";
import {
  RETAKE_FACTOR,
  buildFilmingPlan,
  countWords,
  formatMinutes,
  setupWords,
  spokenWords,
  wordsToMinutes,
  type PlanScript,
} from "./plan";

/** A fixture body with `words` spoken words in its one section and the given talking points. */
function body(words: number, talkingPoints: string[] = []): ScriptBodyV1 {
  const b = sampleScriptBody();
  b.hook.spokenLines = ["Hook."];
  b.cta.spokenLines = ["Bye."];
  b.sections[0]!.spokenLines = [Array.from({ length: words - 2 }, () => "word").join(" ")];
  b.sections[0]!.talkingPoints = talkingPoints;
  return b;
}

function script(
  id: number,
  title: string,
  words: number,
  talkingPoints: string[] = [],
): PlanScript {
  return { id, title, body: body(words, talkingPoints) };
}

test("words are counted across hook, sections and call to action, and not in notes", () => {
  assert.equal(countWords("  It takes   about forty-five days. "), 5);
  assert.equal(countWords("   "), 0);
  // 7 (hook) + 10 (section) + 5 (cta); talking points and on-screen text are not spoken.
  assert.equal(spokenWords(sampleScriptBody()), 22);
});

test("time math: words ÷ 150 per minute, and half as long again for retakes", () => {
  assert.equal(wordsToMinutes(150), 1);
  assert.equal(wordsToMinutes(450), 3);
  assert.equal(RETAKE_FACTOR, 1.5);

  const plan = buildFilmingPlan([script(1, "A", 300), script(2, "B", 150)]);
  const a = plan.items.find((i) => i.id === 1)!;
  assert.equal(a.words, 300);
  assert.equal(a.spokenMinutes, 2);
  assert.equal(a.withRetakesMinutes, 3);
  assert.equal(plan.totalWords, 450);
  assert.equal(plan.totalSpokenMinutes, 3);
  assert.equal(plan.totalWithRetakesMinutes, 4.5);
});

test("setup words are found as whole words in talking points, locations before props", () => {
  const b = body(10, [
    "Film at the desk with the passport in hand",
    "Carpeta azul en el escritorio",
  ]);
  assert.deepEqual(setupWords(b), ["desk", "escritorio", "passport", "carpeta"]);
  // "cartoon" contains "car" but is not the car.
  assert.deepEqual(setupWords(body(10, ["A cartoon style intro"])), []);
  // Spoken lines do not count — only Anton's notes say where he films.
  const spoken = body(10);
  spoken.sections[0]!.spokenLines = ["I sat in the kitchen for hours."];
  assert.deepEqual(setupWords(spoken), []);
});

test("order: shared setups are filmed together, bigger groups first, longest first inside a group, no setup last", () => {
  const plan = buildFilmingPlan([
    script(1, "No notes, long", 900),
    script(2, "Desk short", 150, ["At the desk"]),
    script(3, "Car", 300, ["Film in the car"]),
    script(4, "Desk long", 600, ["Desk, laptop open"]),
    script(5, "Desk mid", 300, ["desk"]),
  ]);
  assert.deepEqual(
    plan.items.map((i) => i.id),
    [4, 5, 2, 3, 1],
  );
  assert.deepEqual(
    plan.items.map((i) => i.group),
    ["desk", "desk", "desk", "car", null],
  );
});

test("a script is grouped under a setup word another selected script shares, not just its first", () => {
  const plan = buildFilmingPlan([
    script(1, "Office with passport", 300, ["In the office, passport on the table"]),
    script(2, "Passport close-up", 200, ["Passport close-up"]),
    script(3, "Outside", 250, ["outside"]),
  ]);
  assert.deepEqual(
    plan.items.map((i) => [i.id, i.group]),
    [
      [1, "passport"],
      [2, "passport"],
      [3, "outside"],
    ],
  );
});

test("the same ticks always print the same order (ties by title, then id)", () => {
  const scripts = [script(9, "Beta", 300), script(3, "Alpha", 300), script(7, "Alpha", 300)];
  const once = buildFilmingPlan(scripts).items.map((i) => i.id);
  const again = buildFilmingPlan([...scripts].reverse()).items.map((i) => i.id);
  assert.deepEqual(once, [3, 7, 9]);
  assert.deepEqual(again, once);
});

test("on-screen checklist and b-roll list combine every script, in filming order", () => {
  const plan = buildFilmingPlan([
    { id: 1, title: "First", body: sampleScriptBody() },
    { id: 2, title: "Second", body: body(400, ["desk"]) },
  ]);
  // Script 2 has a setup, so it is filmed first.
  assert.equal(plan.onScreen[0]!.scriptId, 2);
  assert.deepEqual(
    plan.onScreen.filter((o) => o.scriptId === 1).map((o) => [o.part, o.text]),
    [
      ["Hook", "90 → 45"],
      ["The real timeline", "~45 days"],
    ],
  );
  const first = plan.broll.filter((b) => b.scriptId === 1);
  assert.deepEqual(
    first.map((b) => [b.part, b.description, b.still, b.aspectRatio]),
    [
      ["Hook", "Calendar pages flipping", false, "16:9"],
      ["The real timeline", "Stopwatch on forms", true, "9:16"],
    ],
  );
});

test("an empty selection is an empty plan", () => {
  const plan = buildFilmingPlan([]);
  assert.deepEqual(plan.items, []);
  assert.equal(plan.totalWithRetakesMinutes, 0);
});

test("minutes print rounded up, with hours past sixty", () => {
  assert.equal(formatMinutes(0.25), "0.3 min");
  assert.equal(formatMinutes(4.2), "5 min");
  assert.equal(formatMinutes(60), "1 h 00 min");
  assert.equal(formatMinutes(125.5), "2 h 06 min");
});
