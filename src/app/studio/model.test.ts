/**
 * The studio's pure helpers, and the teleprompter rendered to static markup
 * (PLAN.md §6.S12 exit: "teleprompter renders").
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StudioTeleprompter } from "@/components/StudioTeleprompter";
import { validateScriptBody } from "@/lib/scripts/contract";
import { sampleScriptBody } from "@/lib/scripts/fixture";
import { errorsUnder, normalizeBody, parseBriefParams, teleprompterBlocks } from "./model";

test("parseBriefParams reads ?brand= and repeated ?ref=, ignoring junk and duplicates", () => {
  assert.deepEqual(
    parseBriefParams({ brand: "residency-guide", ref: ["12", "7", "12", "abc", "-3", "0"] }),
    {
      brand: "residency-guide",
      refs: [12, 7],
    },
  );
  assert.deepEqual(parseBriefParams({ ref: "5,6" }), { brand: null, refs: [5, 6] });
  assert.deepEqual(parseBriefParams({ brand: "  " }), { brand: null, refs: [] });
});

test("normalizeBody drops blank rows, trims lines and turns an empty video prompt into a still", () => {
  const body = sampleScriptBody();
  body.hook.spokenLines = ["  First.  ", "", "Second."];
  body.sections[0]!.talkingPoints = ["", "  "];
  body.hook.broll[0]!.videoPrompt = "   ";
  const clean = normalizeBody(body);
  assert.deepEqual(clean.hook.spokenLines, ["First.", "Second."]);
  assert.deepEqual(clean.sections[0]!.talkingPoints, []);
  assert.equal(clean.hook.broll[0]!.videoPrompt, null);
  assert.deepEqual(
    body.hook.spokenLines,
    ["  First.  ", "", "Second."],
    "the input is not mutated",
  );
  assert.ok(validateScriptBody(clean).ok);
});

test("errorsUnder matches a path exactly, not a longer index", () => {
  const errors = [
    "body.sections[1].heading must not be empty",
    "body.sections[10] must be an object",
    "body.sections[1] x",
  ];
  assert.deepEqual(errorsUnder(errors, "body.sections[1]"), [
    "body.sections[1].heading must not be empty",
    "body.sections[1] x",
  ]);
});

test("teleprompter blocks are spoken lines only, with flagged sources on their section", () => {
  const body = sampleScriptBody();
  body.sources[0]!.verifyBeforeRecording = true;
  body.sections[0]!.sourceIds = [body.sources[0]!.id];
  const blocks = teleprompterBlocks(body);
  assert.equal(blocks[0]!.kind, "hook");
  assert.equal(blocks.at(-1)!.kind, "cta");
  assert.deepEqual(blocks[1]!.verify, [body.sources[0]!.id]);
  const all = blocks.flatMap((b) => b.lines).join("\n");
  for (const point of body.sections[0]!.talkingPoints)
    assert.ok(!all.includes(point), "talking points are not read aloud");
  for (const text of body.sections[0]!.onScreenText)
    assert.ok(!all.includes(text), "on-screen text is not read aloud");
});

// tsx compiles JSX with the classic runtime (tsconfig has `jsx: preserve` for
// Next), so the component's JSX needs a global React here.
Object.assign(globalThis, { React });

test("the teleprompter renders every spoken line, the verify badge and its controls", () => {
  const body = sampleScriptBody();
  body.sources[0]!.verifyBeforeRecording = true;
  body.sections[0]!.sourceIds = [body.sources[0]!.id];
  const html = renderToStaticMarkup(
    createElement(StudioTeleprompter, {
      title: body.chosenTitle,
      blocks: teleprompterBlocks(body),
      backHref: "/studio/1",
    }),
  );
  for (const line of [
    ...body.hook.spokenLines,
    ...body.sections[0]!.spokenLines,
    ...body.cta.spokenLines,
  ]) {
    assert.ok(html.includes(line.replace(/'/g, "&#x27;")), `renders "${line}"`);
  }
  assert.match(html, /data-verify-badge/);
  assert.match(html, /Verify before recording/);
  assert.match(html, /type="range"/, "speed and size sliders");
  assert.match(html, /font-size:56px/);
  assert.match(html, /href="\/studio\/1"/);
});
