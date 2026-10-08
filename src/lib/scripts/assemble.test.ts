import assert from "node:assert/strict";
import { test } from "node:test";

import { assembleScriptBody } from "../ai";
import { PAYLOADS } from "../ai-fake";
import { validateScriptBody } from "./contract";

/**
 * `assembleScriptBody` over the fake's script payload, which carries the two
 * mistakes it repairs (see the comment on PAYLOADS.script).
 */
const brief = {
  topic: "Residency timeline",
  title: "Paraguay residency in 45 days",
  targetMinutes: 6,
  language: "en" as const,
};

test("the model's answer becomes a valid v1 body with the app's own fields filled in", () => {
  const body = assembleScriptBody(structuredClone(PAYLOADS.script) as never, brief);
  assert.deepEqual(validateScriptBody(body), { ok: true });
  assert.equal(body.version, 1);
  assert.equal(body.chosenTitle, brief.title);
  assert.equal(body.language, "en");
  assert.equal(
    body.hook.broll[0].videoPrompt,
    "Pages flip quickly from left to right, slow push-in",
  );
  assert.equal(body.sections[0].broll[0].videoPrompt, null, "an empty video prompt is a still");
});

test("a source without a URL is dropped and its claim marked UNSOURCED where it was used; unknown ids are dropped", () => {
  const body = assembleScriptBody(structuredClone(PAYLOADS.script) as never, brief);
  assert.deepEqual(
    body.sources.map((s) => s.id),
    ["s1", "s2"],
  );
  assert.deepEqual(body.sections[0].sourceIds, ["s1"], "s9 never existed");
  assert.deepEqual(body.sections[1].sourceIds, ["s2"]);
  assert.ok(
    body.sections[1].talkingPoints.some((t) =>
      t.startsWith("UNSOURCED — verify or cut: Sworn translations"),
    ),
  );
});

test("the verify flag is the model's OR the fact heuristic's", () => {
  const body = assembleScriptBody(structuredClone(PAYLOADS.script) as never, brief);
  const s2 = body.sources.find((s) => s.id === "s2");
  assert.equal(
    s2?.verifyBeforeRecording,
    true,
    "a fee claim is flagged although the model said false",
  );
});
