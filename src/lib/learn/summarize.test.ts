import assert from "node:assert/strict";
import { test } from "node:test";

import { validate } from "@/lib/ai-fake";

import { LEARN_CATEGORIES, isLearnCategory, toLearnCategory } from "./categories";
import {
  buildLearnPrompt,
  estimateLearnSummaryCostUsd,
  hasLearnContent,
  LEARN_SUMMARY_JSON_SCHEMA,
  LEARN_TRANSCRIPT_MAX_CHARS,
  learnSummaryText,
  LearnSummaryError,
  parseLearnSummary,
  summarizeLearn,
  type LearnModelRunner,
} from "./summarize";

const CANNED = {
  title: "Claude Code hooks",
  whatItIs: "Shell commands Claude Code runs on events.",
  whyItMatters: "Automates formatting and checks.",
  howToStart: ["npm i -g @anthropic-ai/claude-code", "Add a hook in settings.json"],
  category: "ai-coding-tool",
  tags: ["Claude", "hooks", "claude"],
};

test("the canned answer is valid against the learn schema (what the fake would enforce)", () => {
  validate(CANNED, LEARN_SUMMARY_JSON_SCHEMA);
  assert.deepEqual(LEARN_SUMMARY_JSON_SCHEMA.properties.category.enum, [...LEARN_CATEGORIES]);
});

test("categories: exact values kept, legacy free text mapped like aiinsights did", () => {
  assert.equal(LEARN_CATEGORIES.length, 11);
  assert.ok(isLearnCategory("self-hosting"));
  assert.equal(isLearnCategory("Self Hosting"), false);
  assert.equal(toLearnCategory("AI Coding Assistant"), "ai-coding-tool");
  assert.equal(toLearnCategory("LLM model"), "ai-model-or-api");
  assert.equal(toLearnCategory("api"), "ai-model-or-api");
  assert.equal(toLearnCategory("Automation"), "agent-or-automation");
  assert.equal(toLearnCategory("self-hosted"), "self-hosting");
  assert.equal(toLearnCategory("Chrome extension"), "browser-extension");
  assert.equal(toLearnCategory("web scraping"), "data-or-scraping");
  assert.equal(toLearnCategory("something else"), "other");
  assert.equal(toLearnCategory(""), null);
  assert.equal(toLearnCategory(null), null);
});

test("the prompt carries every source, labelled, and cuts a long transcript", () => {
  const prompt = buildLearnPrompt({
    url: "https://github.com/a/b",
    platform: "other",
    title: "a/b",
    note: "try this",
    caption: "A thing",
    transcript: "x".repeat(LEARN_TRANSCRIPT_MAX_CHARS + 50),
    repoUrl: "https://github.com/a/b",
    repoReadme: "# b\nInstall with npm",
    screenshot: "On screen: npx b",
  });
  for (const part of [
    "Source URL: https://github.com/a/b",
    "The user's own note about it: try this",
    "Post caption / page description:\nA thing",
    "(truncated)",
    "Screenshot, as read:\nOn screen: npx b",
    "Repo README excerpt:\n# b",
  ]) {
    assert.ok(prompt.includes(part), `prompt has ${part}`);
  }
  assert.ok(prompt.length < LEARN_TRANSCRIPT_MAX_CHARS + 1000);
});

test("hasLearnContent: a bare URL is not enough; a note is", () => {
  assert.equal(hasLearnContent({ url: "https://x.test", platform: "other" }), false);
  assert.equal(hasLearnContent({ url: "https://x.test", platform: "other", note: " " }), false);
  assert.equal(hasLearnContent({ url: "https://x.test", platform: "other", note: "hi" }), true);
});

test("parse: tags deduped and lower-cased, unknown category mapped, missing parts refused", () => {
  const out = parseLearnSummary(JSON.stringify({ ...CANNED, category: "Automation agents" }));
  assert.deepEqual(out.tags, ["claude", "hooks"]);
  assert.equal(out.category, "agent-or-automation");
  assert.equal(out.howToStart.length, 2);
  assert.equal(
    learnSummaryText(out),
    "Shell commands Claude Code runs on events.\n\nWhy it matters: Automates formatting and checks.",
  );
  assert.throws(() => parseLearnSummary("not json"), LearnSummaryError);
  assert.throws(
    () => parseLearnSummary(JSON.stringify({ ...CANNED, whatItIs: " " })),
    LearnSummaryError,
  );
  assert.throws(
    () => parseLearnSummary(JSON.stringify({ ...CANNED, howToStart: [] })),
    LearnSummaryError,
  );
  assert.equal(parseLearnSummary(JSON.stringify({ ...CANNED, title: "" })).title, "Saved item");
});

test("summarizeLearn sends the schema and a cap reservation through the runner", async () => {
  const seen: Parameters<LearnModelRunner>[0][] = [];
  const run: LearnModelRunner = async (opts) => {
    seen.push(opts);
    validate(CANNED, opts.schema);
    return { text: JSON.stringify(CANNED), costUsd: 0.0012 };
  };
  const out = await summarizeLearn({ url: "https://x.test", platform: "other", note: "n" }, run);
  assert.equal(out.category, "ai-coding-tool");
  assert.equal(out.costUsd, 0.0012);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.schema, LEARN_SUMMARY_JSON_SCHEMA);
  assert.ok(seen[0]!.estimateUsd > 0 && seen[0]!.estimateUsd === estimateLearnSummaryCostUsd());
  assert.match(seen[0]!.system, /Always write in English/);
});
