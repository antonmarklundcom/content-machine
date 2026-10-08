import assert from "node:assert/strict";
import { test } from "node:test";

import { buildStoryLines } from "./lines";
import {
  countsAsRecorded,
  lineStates,
  nextUnrecorded,
  sessionProgress,
  stepLine,
  type RecordTakeLike,
} from "./resume";

const scenes = [
  { sceneRef: "S01", text: { es: "Uno." }, textStatus: { es: "approved" } },
  {
    sceneRef: "S02",
    text: { es: "Dos. Tres." },
    textStatus: { es: "approved" },
    lines: {
      es: [
        { speaker: null, text: "Dos." },
        { speaker: "tito", text: "Tres." },
      ],
    },
  },
  { sceneRef: "S03", text: { es: "Cuatro." }, textStatus: { es: "draft" } },
  { sceneRef: "S04", text: { es: "Cinco." }, textStatus: { es: "approved" } },
];
const lines = buildStoryLines("tito", scenes, "es");

let nextId = 1;
function take(over: Partial<RecordTakeLike>): RecordTakeLike {
  return {
    id: nextId++,
    ownerKind: "story_scene",
    ownerRef: "story:tito",
    sceneRef: "S01",
    language: "es-PY",
    voiceProfileId: 5,
    speaker: null,
    provider: "manual",
    status: "done",
    inputText: "Uno.",
    reviewStatus: "unreviewed",
    selected: false,
    durationMs: 1500,
    ...over,
  };
}

test("a take counts only when it is this profile's finished manual take of the current text", () => {
  const line = lines[0];
  assert.ok(countsAsRecorded(line, take({}), 5, "es-PY"));
  assert.ok(!countsAsRecorded(line, take({ voiceProfileId: 6 }), 5, "es-PY"), "other profile");
  assert.ok(!countsAsRecorded(line, take({ provider: "azure" }), 5, "es-PY"), "TTS take");
  assert.ok(!countsAsRecorded(line, take({ status: "failed" }), 5, "es-PY"), "failed");
  assert.ok(!countsAsRecorded(line, take({ language: "gn" }), 5, "es-PY"), "other language");
  assert.ok(!countsAsRecorded(line, take({ inputText: "Uno" }), 5, "es-PY"), "older text");
  assert.ok(!countsAsRecorded(line, take({ reviewStatus: "rejected" }), 5, "es-PY"), "rejected");
  assert.ok(!countsAsRecorded(line, take({ sceneRef: "S01#1" }), 5, "es-PY"), "other slot");
  assert.ok(!countsAsRecorded(line, take({ speaker: "tito" }), 5, "es-PY"), "other speaker");
});

test("resume at the first unlocked line without a take by this profile; progress counts", () => {
  const takes = [
    take({ sceneRef: "S01", durationMs: 1200 }),
    take({ sceneRef: "S01", durationMs: 1400 }), // a second keep of S01: the newest counts
    take({ sceneRef: "S02#1", inputText: "Dos.", voiceProfileId: 9, selected: true }),
    take({ sceneRef: "S02#2", inputText: "Tres.", speaker: "tito", durationMs: 900 }),
  ];
  const states = lineStates(lines, takes, 5, "es-PY");
  assert.deepEqual(
    states.map((s) => [s.slot, s.takeCount, !!s.locked]),
    [
      ["S01", 2, false],
      ["S02#1", 0, false],
      ["S02#2", 1, false],
      ["S03", 0, true],
      ["S04", 0, false],
    ],
  );
  assert.equal(states[1].hasSelected, true, "someone else's selected take is still a selection");
  const p = sessionProgress(states);
  assert.deepEqual(p, { total: 4, recorded: 2, locked: 1, recordedMs: 2300, resumeIndex: 1 });
  assert.equal(nextUnrecorded(states, 2), 4, "skips the locked S03");
  assert.equal(nextUnrecorded(states, 5 % states.length), 1);
});

test("all recorded → no resume point; an empty session has none either", () => {
  const all = [
    take({ sceneRef: "S01" }),
    take({ sceneRef: "S02#1", inputText: "Dos." }),
    take({ sceneRef: "S02#2", inputText: "Tres.", speaker: "tito" }),
    take({ sceneRef: "S04", inputText: "Cinco." }),
  ];
  assert.equal(sessionProgress(lineStates(lines, all, 5, "es-PY")).resumeIndex, null);
  assert.equal(sessionProgress([]).resumeIndex, null);
});

test("stepping skips locked lines and stays put at the ends", () => {
  const states = lineStates(lines, [], 5, "es-PY");
  assert.equal(stepLine(states, 2, 1), 4);
  assert.equal(stepLine(states, 4, -1), 2);
  assert.equal(stepLine(states, 4, 1), 4);
  assert.equal(stepLine(states, 0, -1), 0);
  assert.equal(stepLine(states, -1, 1), 0);
});
