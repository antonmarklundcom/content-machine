import assert from "node:assert/strict";
import { test } from "node:test";

import { validateScriptBody } from "./contract";
import { sampleScriptBody } from "./fixture";

/** The script contract (PLAN.md §1.32): what videoPY will read, so it must be strict and say why. */

function errorsOf(body: unknown): string[] {
  const verdict = validateScriptBody(body);
  return verdict.ok ? [] : verdict.errors;
}

test("a complete v1 body is valid", () => {
  assert.deepEqual(validateScriptBody(sampleScriptBody()), { ok: true });
});

test("a body that is not an object is refused with one readable error", () => {
  assert.deepEqual(errorsOf(null), ["body must be an object, got null"]);
  assert.deepEqual(errorsOf([]), ["body must be an object, got a list"]);
});

test("missing fields are each named by their path", () => {
  const body = sampleScriptBody() as Record<string, unknown>;
  delete body.hook;
  delete body.sources;
  (body.sections as Record<string, unknown>[])[0].broll = [
    { spokenLine: "x", description: "y", videoPrompt: null, aspectRatio: "16:9" },
  ];
  const errors = errorsOf(body);
  assert.ok(errors.includes("body.hook is missing"), errors.join("\n"));
  assert.ok(errors.includes("body.sources is missing"));
  assert.ok(errors.includes("body.sections[0].broll[0].imagePrompt is missing"));
  // With no sources at all, a section citing one is also reported.
  assert.ok(
    errors.includes(
      'body.sections[0].sourceIds[0] refers to source "s1", which is not in body.sources',
    ),
  );
});

test("extra fields are refused at every level, so a typo cannot be silently dropped", () => {
  const body = sampleScriptBody() as unknown as Record<string, unknown>;
  body.thumbnail = "oops";
  (body.hook as Record<string, unknown>).spokenLine = "singular typo";
  (body.sources as Record<string, unknown>[])[0].verified = true;
  assert.deepEqual(errorsOf(body).sort(), [
    "body.hook.spokenLine is not a field of this contract",
    "body.sources[0].verified is not a field of this contract",
    "body.thumbnail is not a field of this contract",
  ]);
});

test("wrong values say what was expected and what arrived", () => {
  const body = sampleScriptBody() as unknown as Record<string, unknown>;
  body.version = 2;
  body.language = "es";
  body.targetMinutes = 0;
  (body.titleOptions as unknown[]).pop();
  const sections = body.sections as Record<string, unknown>[];
  sections[0].spokenLines = [];
  (sections[0].broll as Record<string, unknown>[])[0].aspectRatio = "4:3";
  (body.sources as Record<string, unknown>[])[0].url = "example.com/no-scheme";
  const errors = errorsOf(body);
  for (const expected of [
    "body.version must be 1, got number 2",
    'body.language must be one of "en", "es-PY", "jopara", got "es"',
    "body.targetMinutes must be a number of minutes between 0 and 60, got number 0",
    "body.titleOptions must have exactly 3 items, has 2",
    "body.sections[0].spokenLines must have at least 1 items, has 0",
    'body.sections[0].broll[0].aspectRatio must be one of "16:9", "9:16", "1:1", got "4:3"',
    'body.sources[0].url must be an http(s) URL, got "example.com/no-scheme"',
  ]) {
    assert.ok(errors.includes(expected), `expected "${expected}" in:\n${errors.join("\n")}`);
  }
});

test("empty text and duplicate source ids are refused; an empty textOverlay and a null videoPrompt are fine", () => {
  const body = sampleScriptBody();
  body.sections[0].heading = "   ";
  body.sources.push({ ...body.sources[0] });
  const errors = errorsOf(body);
  assert.deepEqual(errors.sort(), [
    "body.sections[0].heading must not be empty",
    'body.sources[1].id "s1" is used by another source',
  ]);
  assert.equal(sampleScriptBody().thumbnailConcepts[1].textOverlay, "");
  assert.equal(sampleScriptBody().sections[0].broll[0].videoPrompt, null);
});
