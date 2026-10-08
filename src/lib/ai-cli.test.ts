import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { writeFile, mkdtemp, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  aiProvider,
  buildCliPrompt,
  claudeCommand,
  codexCommand,
  extractJson,
  runCliJson,
  unwrapClaudeEnvelope,
} from "./ai-cli";

test("aiProvider defaults to gemini and accepts short names", () => {
  assert.equal(aiProvider({}), "gemini");
  assert.equal(aiProvider({ AI_PROVIDER: "Claude" }), "claude-cli");
  assert.equal(aiProvider({ AI_PROVIDER: "codex-cli" }), "codex-cli");
  assert.equal(aiProvider({ AI_PROVIDER: "openai" }), "gemini");
});

test("extractJson handles bare, fenced and chatty replies", () => {
  assert.equal(extractJson('{"a":1}'), '{"a":1}');
  assert.equal(extractJson('Sure!\n```json\n{"a":{"b":2}}\n```'), '{"a":{"b":2}}');
  assert.equal(extractJson('Here you go: {"a":1} hope it helps'), '{"a":1}');
  assert.throws(() => extractJson("no json here"), /no JSON/);
  assert.throws(() => extractJson("{not json}"));
});

test("unwrapClaudeEnvelope reads result and surfaces errors", () => {
  assert.equal(unwrapClaudeEnvelope('{"type":"result","result":"{\\"a\\":1}"}'), '{"a":1}');
  assert.throws(() => unwrapClaudeEnvelope('{"is_error":true,"result":"limit"}'), /limit/);
  assert.equal(unwrapClaudeEnvelope("plain"), "plain");
});

test("prompt carries the schema and the search instruction", () => {
  const p = buildCliPrompt("SYS", "USER", { type: "object" }, true);
  assert.match(p, /^SYS/);
  assert.match(p, /web search/);
  assert.match(p, /"type":"object"/);
  assert.match(p, /USER$/);
  assert.match(buildCliPrompt("S", "U", {}, false), /Do not browse/);
});

test("commands: claude gets tools only with search; codex is read-only", () => {
  assert.deepEqual(claudeCommand(false, {}).args, ["-p", "--output-format", "json"]);
  assert.ok(claudeCommand(true, { CLAUDE_CLI_MODEL: "opus" }).args.includes("WebSearch"));
  const c = codexCommand("/tmp/x", { CODEX_CLI_ARGS: "--search" });
  assert.deepEqual(c.args.slice(0, 4), ["exec", "--skip-git-repo-check", "--sandbox", "read-only"]);
  assert.ok(c.args.includes("--search"));
  assert.equal(c.args.at(-1), "-");
});

test(
  "runCliJson runs a fake claude and returns its JSON",
  { skip: process.platform === "win32" },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fake-cli-"));
    const bin = path.join(dir, "claude");
    await writeFile(
      bin,
      `#!/usr/bin/env node
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
process.stdout.write(JSON.stringify({type:"result",result:"ok "+JSON.stringify({len:s.length>0})}));});`,
    );
    await chmod(bin, 0o755);
    const prev = process.env.CLAUDE_CLI_BIN;
    process.env.CLAUDE_CLI_BIN = bin;
    try {
      const out = await runCliJson({
        provider: "claude-cli",
        system: "s",
        prompt: "p",
        schema: {},
        webSearch: false,
      });
      assert.deepEqual(JSON.parse(out), { len: true });
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CLI_BIN;
      else process.env.CLAUDE_CLI_BIN = prev;
    }
  },
);

test("runCliJson explains a missing binary", async () => {
  const prev = process.env.CLAUDE_CLI_BIN;
  process.env.CLAUDE_CLI_BIN = "/nonexistent/claude-xyz";
  try {
    await assert.rejects(
      runCliJson({
        provider: "claude-cli",
        system: "s",
        prompt: "p",
        schema: {},
        webSearch: false,
      }),
      /SUBSCRIPTION-MODE|exited|Could not start/,
    );
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CLI_BIN;
    else process.env.CLAUDE_CLI_BIN = prev;
  }
});
