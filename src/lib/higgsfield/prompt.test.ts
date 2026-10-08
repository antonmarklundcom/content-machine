import assert from "node:assert/strict";
import { test } from "node:test";

import { claudeBin, defaultMaxCredits, jobTimeoutMs, targetHref, targetRefFor } from "./config";
import {
  allowedTools,
  buildRunPrompt,
  buildRecoveryRunPrompt,
  ceilingText,
  downloadCommand,
  claudeRunArgs,
  extractArgument,
  mcpToolPrefix,
  rulePath,
} from "./prompt";

const BRIEF = '# Generation brief — post 41: Cédula\n\n```json\n{"postId":41}\n```';

test("the prompt is the slash command, the brief inline, and the ceiling", () => {
  const prompt = buildRunPrompt({
    kind: "post",
    jobId: 7,
    argument: BRIEF,
    maxCredits: 15,
    mediaRoot: "E:\\ContentEngine",
  });
  assert.ok(prompt.startsWith("/higgsfield-post # Generation brief — post 41"));
  assert.ok(prompt.includes('{"postId":41}'), "brief JSON is inline");
  assert.ok(
    prompt.includes("Spend at most 15 credits: check balance first, preflight with get_cost"),
  );
  assert.ok(prompt.includes("stop before exceeding 15 credits; report balance before/after"));
  assert.ok(prompt.includes("job #7"));
  assert.ok(prompt.includes("MEDIA_ROOT is `E:/ContentEngine`"));
  for (const marker of ["HF_BALANCE before", "HF_JOB", "HF_FILE", "HF_BALANCE after", "HF_CREDITS"])
    assert.ok(prompt.includes(marker), marker);
  assert.ok(
    prompt.includes(`${downloadCommand("E:/ContentEngine")} "<path relative to MEDIA_ROOT>"`),
  );
  assert.ok(prompt.includes("read `.claude/commands/higgsfield-post.md`"));
});

test("each kind runs its command", () => {
  const base = { jobId: 1, argument: "x", maxCredits: 5, mediaRoot: "/m" };
  assert.ok(buildRunPrompt({ ...base, kind: "script_shots" }).startsWith("/higgsfield-shots x"));
  assert.ok(
    buildRunPrompt({ ...base, kind: "script_thumbnails" }).startsWith("/higgsfield-thumbnails x"),
  );
  assert.ok(buildRunPrompt({ ...base, kind: "import" }).startsWith("/higgsfield-import x"));
  assert.ok(buildRunPrompt({ ...base, kind: "free" }).startsWith("/higgsfield-free x"));
});

test("a zero ceiling forbids generating", () => {
  assert.match(ceilingText(0), /must not generate anything/);
});

test("extractArgument recovers the request for a retry", () => {
  const prompt = buildRunPrompt({
    kind: "free",
    jobId: 3,
    argument: "# Free prompt\n\nthree sunsets",
    maxCredits: 5,
    mediaRoot: "/m",
  });
  assert.equal(extractArgument(prompt), "# Free prompt\n\nthree sunsets");
  const empty = buildRunPrompt({
    kind: "import",
    jobId: 4,
    argument: "",
    maxCredits: 0,
    mediaRoot: "/m",
  });
  assert.equal(extractArgument(empty), "");
  assert.equal(extractArgument("not a prompt"), null);
});

test("permission rules: MCP server, MEDIA_ROOT files and the staged downloader", () => {
  assert.equal(rulePath("E:\\ContentEngine"), "//e/ContentEngine");
  assert.equal(rulePath("/home/anton/media/"), "//home/anton/media");
  assert.equal(mcpToolPrefix("claude.ai Higgsfield"), "mcp__claude_ai_Higgsfield");
  const tools = allowedTools({ mediaRoot: "E:\\ContentEngine", mcpServers: ["higgsfield"] });
  assert.deepEqual(tools, [
    "mcp__higgsfield",
    "Read(//e/ContentEngine/**)",
    "Write(//e/ContentEngine/**)",
    "Edit(//e/ContentEngine/**)",
    "Read(.claude/commands/higgsfield-*.md)",
    `Bash(${downloadCommand("E:/ContentEngine")} :*)`,
  ]);
  const args = claudeRunArgs({ mediaRoot: "/m", mcpServers: [], model: "opus" });
  assert.deepEqual(args.slice(0, 6), [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    "opus",
  ]);
  assert.equal(args[6], "--allowedTools");
  assert.ok(args[7].startsWith("mcp__higgsfield,Read(//m/**)"));
});

test("config reads the environment with defaults", () => {
  assert.equal(claudeBin({}), "claude");
  assert.equal(claudeBin({ CLAUDE_CLI_BIN: "c2" }), "c2");
  assert.equal(claudeBin({ CLAUDE_CLI_PATH: "/opt/claude", CLAUDE_CLI_BIN: "c2" }), "/opt/claude");
  assert.equal(jobTimeoutMs({}), 30 * 60 * 1000);
  assert.equal(jobTimeoutMs({ HIGGSFIELD_JOB_TIMEOUT_MIN: "0.5" }), 30 * 1000);
  assert.equal(defaultMaxCredits({}), 20);
  assert.equal(defaultMaxCredits({ HIGGSFIELD_DEFAULT_MAX_CREDITS: "8" }), 8);
  assert.equal(targetRefFor("post", 4), "post:4");
  assert.equal(targetRefFor("script_shots", 4), "script:4");
  assert.equal(targetHref("script_thumbnails", "script:4"), "/studio/4/thumbnails");
  assert.equal(targetHref("free", null), null);
});

test("a known remote retry preserves input lineage and cannot call generation tools", () => {
  const prompt = buildRecoveryRunPrompt({
    kind: "post",
    jobId: 9,
    argument: BRIEF,
    maxCredits: 50,
    mediaRoot: "/m",
    recovery: { sourceJobId: 7, externalJobIds: ["remote-accepted", "remote-accepted"] },
  });
  assert.equal(extractArgument(prompt), BRIEF);
  assert.match(prompt, /Source content-engine job: #7/);
  assert.ok(prompt.includes('Known Higgsfield jobs: ["remote-accepted"]'));
  assert.match(prompt, /Spend at most 0 credits/);
  assert.match(prompt, /unknown, or unverifiable remote state/);
  const tools = allowedTools({ mediaRoot: "/m", mcpServers: ["higgsfield"], recoveryOnly: true });
  const providerTools = tools.filter((tool) => tool.startsWith("mcp__"));
  assert.deepEqual(providerTools, [
    "mcp__higgsfield__balance",
    "mcp__higgsfield__jobs_wait",
    "mcp__higgsfield__show_generations",
  ]);
  assert.ok(
    !providerTools.includes("mcp__higgsfield"),
    "whole-server generation permission is absent",
  );
  const args = claudeRunArgs({ mediaRoot: "/m", mcpServers: ["higgsfield"], recoveryOnly: true });
  assert.equal(args.at(-1), tools.join(","));
});
