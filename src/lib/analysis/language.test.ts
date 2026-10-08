/**
 * PR-22b's whole claim is "English is unchanged". These tests are what makes
 * that checkable rather than asserted: if a future edit to the prompt builders
 * alters the English output by one byte, every analysis already stored is
 * silently a different prompt version from the ones after it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analysisPromptVersion,
  ANALYSIS_PROMPT_VERSION,
  isDefaultLanguage,
  outlinePromptVersion,
  OUTLINE_PROMPT_VERSION,
} from "./contract";
import { buildUserPrompt } from "./prompt";
import { buildOutlineUserPrompt } from "./outline-prompt";

const VIDEO = {
  title: "How to build a thing",
  channelTitle: "A Channel",
  durationSeconds: 1830,
  transcript: "so today we are going to talk about building things",
};

const IDEA = {
  videoTitle: "How to build a thing",
  ideaTitle: "The other way",
  ideaPremise: "Most builds start too late",
  ideaWhyNow: "Everyone is shipping this quarter",
};

test("English is byte-identical whether the param is absent, undefined, or 'en'", () => {
  const baseline = buildUserPrompt(VIDEO);
  assert.equal(buildUserPrompt({ ...VIDEO, language: undefined }), baseline);
  assert.equal(buildUserPrompt({ ...VIDEO, language: "en" }), baseline);

  const outlineBaseline = buildOutlineUserPrompt(IDEA);
  assert.equal(buildOutlineUserPrompt({ ...IDEA, language: undefined }), outlineBaseline);
  assert.equal(buildOutlineUserPrompt({ ...IDEA, language: "en" }), outlineBaseline);
});

test("the English prompt still ends with the transcript, nothing appended", () => {
  const prompt = buildUserPrompt(VIDEO);
  assert.ok(prompt.endsWith(VIDEO.transcript), prompt.slice(-120));
});

test("another language appends an instruction and keeps the transcript intact", () => {
  const prompt = buildUserPrompt({ ...VIDEO, language: "Swedish" });
  assert.ok(prompt.includes(VIDEO.transcript));
  assert.ok(prompt.includes("Respond in Swedish."));
  // The instruction goes last: the system prompt stays cacheable and a trailing
  // instruction is the position the model weights most heavily.
  assert.ok(prompt.indexOf(VIDEO.transcript) < prompt.indexOf("Respond in Swedish."));

  const outline = buildOutlineUserPrompt({ ...IDEA, language: "Swedish" });
  assert.ok(outline.includes("Write the outline in Swedish."));
});

test("version bumps only for a non-default language", () => {
  assert.equal(analysisPromptVersion(), ANALYSIS_PROMPT_VERSION);
  assert.equal(analysisPromptVersion("en"), ANALYSIS_PROMPT_VERSION);
  assert.equal(analysisPromptVersion("Swedish"), ANALYSIS_PROMPT_VERSION + 1);

  assert.equal(outlinePromptVersion(), OUTLINE_PROMPT_VERSION);
  assert.equal(outlinePromptVersion("Swedish"), OUTLINE_PROMPT_VERSION + 1);

  assert.equal(isDefaultLanguage(undefined), true);
  assert.equal(isDefaultLanguage("en"), true);
  assert.equal(isDefaultLanguage("sv"), false);
});
