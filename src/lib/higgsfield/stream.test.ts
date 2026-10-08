import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { LOG_TAIL_CHARS, normaliseOutputPath, StreamParser } from "./stream";

const SAMPLE = readFileSync(new URL("./fixtures/stream-sample.jsonl", import.meta.url), "utf8");
const ROOT = "E:\\ContentEngine";

test("parses the sample run: job ids, files, credits, denials", () => {
  const p = new StreamParser(ROOT);
  p.feed(SAMPLE);
  p.end();
  const s = p.state;
  assert.deepEqual(s.externalJobIds, ["d0e1f2a3-1111", "d0e1f2a3-2222"]);
  // The absolute path is made relative; the climbing one is dropped.
  assert.deepEqual(s.outputPaths, [
    "guide/guide-en/2026-10/41-cedula/01-cover.png",
    "guide/guide-en/2026-10/41-cedula/02-steps.png",
  ]);
  assert.equal(s.balanceBefore, 412.5);
  assert.equal(s.balanceAfter, 408.5);
  assert.equal(s.creditsUsed, 4);
  assert.equal(s.finished, true);
  assert.equal(s.isError, false);
  assert.deepEqual(s.permissionDenials, ["Bash"]);
  assert.deepEqual(s.mcpServers, ["higgsfield: connected"]);
  assert.match(s.log, /\[init\] MCP higgsfield: connected/);
  assert.match(s.log, /→ mcp__higgsfield__generate_image_batch/);
  assert.match(s.log, /✗ tool error: Claude requested permissions/);
  assert.match(s.log, /\[result\] success: Files written: 2/);
});

test("lines split across chunks parse the same", () => {
  const whole = new StreamParser(ROOT);
  whole.feed(SAMPLE);
  const split = new StreamParser(ROOT);
  for (let i = 0; i < SAMPLE.length; i += 37) split.feed(SAMPLE.slice(i, i + 37));
  split.end();
  assert.deepEqual(split.state.externalJobIds, whole.state.externalJobIds);
  assert.deepEqual(split.state.outputPaths, whole.state.outputPaths);
  assert.equal(split.state.creditsUsed, whole.state.creditsUsed);
});

test("credits fall back to balance before − after without HF_CREDITS", () => {
  const p = new StreamParser("/media");
  p.feed(
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "HF_BALANCE before 50\nHF_BALANCE after 41.5" }] },
    }) + "\n",
  );
  assert.equal(p.state.creditsUsed, 8.5);
});

test("an error result is a failure with its text", () => {
  const p = new StreamParser("/media");
  p.feed(
    JSON.stringify({
      type: "result",
      subtype: "error_max_turns",
      is_error: true,
      result: "Reached max turns",
    }) + "\n",
  );
  assert.equal(p.state.isError, true);
  assert.equal(p.state.resultText, "Reached max turns");
  const q = new StreamParser("/media");
  q.feed(JSON.stringify({ type: "result", subtype: "error_during_execution" }) + "\n");
  assert.equal(q.state.isError, true);
  assert.equal(q.state.resultText, "error_during_execution");
});

test("non-JSON lines are logged and still scanned", () => {
  const p = new StreamParser("/media");
  p.feed("HF_JOB plain-1\nsome warning\n");
  assert.deepEqual(p.state.externalJobIds, ["plain-1"]);
  assert.match(p.state.log, /some warning/);
});

test("the log is a bounded tail", () => {
  const p = new StreamParser("/media");
  for (let i = 0; i < 2000; i++) p.note(`line ${i} ${"x".repeat(40)}`);
  assert.ok(p.state.log.length <= LOG_TAIL_CHARS);
  assert.match(p.state.log, /line 1999/);
  assert.doesNotMatch(p.state.log, /line 0 /);
});

test("normaliseOutputPath keeps paths inside MEDIA_ROOT only", () => {
  assert.equal(normaliseOutputPath("a/b.png", "/m"), "a/b.png");
  assert.equal(normaliseOutputPath("a\\b.png", "/m"), "a/b.png");
  assert.equal(normaliseOutputPath("/m/a/b.png", "/m"), "a/b.png");
  assert.equal(normaliseOutputPath("/elsewhere/b.png", "/m"), null);
  assert.equal(normaliseOutputPath("../b.png", "/m"), null);
  assert.equal(normaliseOutputPath("C:/x/b.png", "/m"), null);
  // Build 2 script paths are relative to the repo; under <repo>/media they drop the prefix.
  assert.equal(normaliseOutputPath("media/12/01-a.png", "/repo/media"), "12/01-a.png");
  assert.equal(normaliseOutputPath("e:/contentengine/x.png", "E:\\ContentEngine"), "x.png");
});
