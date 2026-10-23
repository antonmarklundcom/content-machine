import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { writeFile, mkdtemp, chmod, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  aiProvider,
  buildCliPrompt,
  claudeCommand,
  codexCommand,
  exitError,
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

test("hosted CLI refuses before executing any binary", async () => {
  const old = process.env.APP_MODE;
  process.env.APP_MODE = "online";
  try {
    for (const provider of ["claude-cli", "codex-cli"] as const)
      await assert.rejects(
        runCliJson({
          provider,
          system: "synthetic",
          prompt: "synthetic",
          schema: {},
          webSearch: false,
        }),
        /runs on the PC/,
      );
  } finally {
    if (old === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = old;
  }
});

test("containment failure is reported as not run, other exits keep their output", () => {
  assert.match(
    exitError("claude", 0x4a0b, "CM_CONTAINMENT_FAILED:AssignProcessToJobObject (5)", "").message,
    /not allowed to run.*owned process job/,
  );
  // The code alone (without the launcher's marker) is just an ordinary exit.
  assert.match(exitError("claude", 0x4a0b, "boom", "").message, /exited with code 18955: boom/);
  assert.match(exitError("codex", 2, "", "out").message, /exited with code 2: out/);
});

test("CLI output limit terminates a synthetic noisy process", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cm-cli-limit-"));
  const bin = path.join(dir, "noisy.mjs");
  await writeFile(bin, 'process.stdout.write("x".repeat(8192));setInterval(()=>{},1000);');
  const old = process.env.CLAUDE_CLI_BIN;
  process.env.CLAUDE_CLI_BIN = bin;
  try {
    await assert.rejects(
      runCliJson({
        provider: "claude-cli",
        system: "s",
        prompt: "p",
        schema: {},
        webSearch: false,
        maxOutputBytes: 1024,
        timeoutMs: 5000,
      }),
      /output limit/,
    );
  } finally {
    if (old === undefined) delete process.env.CLAUDE_CLI_BIN;
    else process.env.CLAUDE_CLI_BIN = old;
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI timeout terminates its synthetic wrapper and grandchild", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cm-cli-tree-"));
  const pidFile = path.join(dir, "child.pid");
  const bin = path.join(dir, "wrapper.mjs");
  await writeFile(
    bin,
    `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000);`,
  );
  const old = process.env.CLAUDE_CLI_BIN;
  process.env.CLAUDE_CLI_BIN = bin;
  try {
    await assert.rejects(
      runCliJson({
        provider: "claude-cli",
        system: "s",
        prompt: "p",
        schema: {},
        webSearch: false,
        // The Windows job launcher needs a moment before the wrapper starts.
        timeoutMs: process.platform === "win32" ? 6000 : 1500,
      }),
      /owned process tree/,
    );
    const pid = Number(await readFile(pidFile, "utf8"));
    let alive = true;
    for (let i = 0; i < 20 && alive; i++) {
      try {
        process.kill(pid, 0);
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false, "owned grandchild must not outlive the timeout");
  } finally {
    if (old === undefined) delete process.env.CLAUDE_CLI_BIN;
    else process.env.CLAUDE_CLI_BIN = old;
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  "POSIX wrapper exit stops a SIGTERM-resistant inherited-pipe descendant",
  { skip: process.platform === "win32" },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cm-cli-exit-"));
    const pidFile = path.join(dir, "child.pid");
    const bin = path.join(dir, "wrapper.mjs");
    await writeFile(
      bin,
      `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const c=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:['ignore',process.stdout,process.stderr]});writeFileSync(${JSON.stringify(pidFile)},String(c.pid));process.stdout.write('{"ok":true}');setTimeout(()=>process.exit(0),300);`,
    );
    const old = process.env.CLAUDE_CLI_BIN;
    process.env.CLAUDE_CLI_BIN = bin;
    let pid = 0;
    try {
      const out = await runCliJson({
        provider: "claude-cli",
        system: "s",
        prompt: "p",
        schema: {},
        webSearch: false,
        timeoutMs: 5000,
      });
      assert.deepEqual(JSON.parse(out), { ok: true });
      pid = Number(await readFile(pidFile, "utf8"));
      // A reparented zombie may remain visible to kill(0) briefly on Linux;
      // /proc status distinguishes it from a running orphan.
      const status = await readFile(`/proc/${pid}/status`, "utf8").catch(() => "");
      assert.ok(
        !status || /^State:\s+Z/m.test(status),
        "descendant must be gone or a terminated zombie",
      );
    } finally {
      if (old === undefined) delete process.env.CLAUDE_CLI_BIN;
      else process.env.CLAUDE_CLI_BIN = old;
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
      await rm(dir, { recursive: true, force: true });
    }
  },
);
