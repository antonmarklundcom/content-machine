import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { invocation, killChildTree, spawnCli, windowsCommandLine } from "./process";
import { launcherArgs, launcherScript, msvcrtQuote } from "./win-job";

const onlyWindows = { skip: process.platform !== "win32" };

test("msvcrtQuote follows the MSVCRT backslash/quote rules", () => {
  assert.equal(msvcrtQuote("plain"), "plain");
  assert.equal(msvcrtQuote(""), '""');
  assert.equal(msvcrtQuote("a b"), '"a b"');
  assert.equal(msvcrtQuote('say "hi"'), '"say \\"hi\\""');
  assert.equal(msvcrtQuote("C:\\my dir\\"), '"C:\\my dir\\\\"');
  assert.equal(msvcrtQuote('a\\"b'), '"a\\\\\\"b"');
  assert.equal(msvcrtQuote("C:\\no\\space"), "C:\\no\\space");
});

test("windowsCommandLine mirrors Node's cmd.exe form for shims", () => {
  const shim = invocation("claude", ["-p", "--model", "x y"]);
  if (process.platform === "win32") {
    assert.equal(
      windowsCommandLine(shim, { ComSpec: "C:\\Windows\\system32\\cmd.exe" }),
      'C:\\Windows\\system32\\cmd.exe /d /s /c "claude -p --model "x y""',
    );
  }
  const script = invocation("C:\\fake dir\\cli.mjs", ["a b"]);
  assert.equal(script.shell, false);
  assert.equal(
    windowsCommandLine(script, {}),
    `${msvcrtQuote(process.execPath)} "C:\\fake dir\\cli.mjs" "a b"`,
  );
});

test("launcher script embeds the command only as base64", () => {
  const line = `node.exe "x"; Remove-Item C:\\ -Recurse; $(evil)`;
  const script = launcherScript(line);
  assert.ok(!script.includes("Remove-Item"));
  assert.ok(!script.includes("$(evil)"));
  assert.ok(script.includes(Buffer.from(line, "utf16le").toString("base64")));
  const args = launcherArgs(line);
  assert.deepEqual(args.slice(0, 6), [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
  ]);
});

// ---- Windows-only synthetic process trees (no real CLI is ever started) ----

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function gone(pid: number, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !alive(pid);
}

async function waitFor(file: string, ms = 15000): Promise<string> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const text = await readFile(file, "utf8").catch(() => "");
    if (text.trim()) return text.trim();
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${file}`);
}

function collect(child: ChildProcess, input = "") {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (d) => (stdout += d));
  child.stderr?.on("data", (d) => (stderr += d));
  const closed = new Promise<{ code: number | null; stdout: string; stderr: string }>((res) =>
    child.on("close", (code) => res({ code, stdout, stderr })),
  );
  child.stdin?.end(input);
  return closed;
}

test("Windows job launcher keeps arguments, stdin and exit code", onlyWindows, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cm-job-args-"));
  try {
    const bin = path.join(dir, "echo args.mjs");
    await writeFile(
      bin,
      `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(JSON.stringify({argv:process.argv.slice(2),len:s.length,tail:s.slice(-4)}));process.exitCode=7;});`,
    );
    const args = ["plain", "two words", 'quote"inside', "trail\\", "C:\\dir with space\\", "ñ✓"];
    const input = "x".repeat(200_000) + "DONE";
    const result = await collect(spawnCli(bin, args, { cwd: dir }), input);
    assert.equal(result.code, 7, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { argv: args, len: input.length, tail: "DONE" });
    assert.equal(result.stderr, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Windows job launcher runs .cmd shims through cmd.exe", onlyWindows, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cm-job-shim-"));
  try {
    await writeFile(
      path.join(dir, "echo.mjs"),
      "process.stdout.write(JSON.stringify(process.argv.slice(2)));",
    );
    const shim = path.join(dir, "fake-cli.cmd");
    await writeFile(shim, `@"${process.execPath}" "%~dp0echo.mjs" %*\r\n`);
    const result = await collect(spawnCli(shim, ["-p", "two words"], { cwd: dir }));
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ["-p", "two words"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  "Windows wrapper exit stops inherited-pipe and detached descendants",
  onlyWindows,
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cm-job-exit-"));
    const pids: number[] = [];
    try {
      const pipeFile = path.join(dir, "pipe.pid");
      const detFile = path.join(dir, "detached.pid");
      const bin = path.join(dir, "wrapper.mjs");
      // One descendant holds the inherited stdout pipe; another is detached
      // and unref'd so the wrapper can exit while it keeps running.
      await writeFile(
        bin,
        `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
const a=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',process.stdout,process.stderr]});
const b=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});b.unref();
writeFileSync(${JSON.stringify(pipeFile)},String(a.pid));writeFileSync(${JSON.stringify(detFile)},String(b.pid));
process.stdout.write('{"ok":true}');setTimeout(()=>process.exit(0),300);`,
      );
      const started = Date.now();
      const result = await collect(spawnCli(bin, [], { cwd: dir }));
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, '{"ok":true}');
      assert.ok(Date.now() - started < 20_000, "close must not wait on orphaned pipe holders");
      pids.push(Number(await waitFor(pipeFile)), Number(await waitFor(detFile)));
      for (const pid of pids) assert.ok(await gone(pid), `descendant ${pid} must be stopped`);
    } finally {
      for (const pid of pids) if (alive(pid)) process.kill(pid);
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "Windows cancellation stops the whole job but not an unrelated process",
  onlyWindows,
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cm-job-kill-"));
    const pids: number[] = [];
    // Started by the test itself, outside any spawnCli job.
    const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    try {
      const files = ["wrapper", "detached", "grandchild"].map((n) => path.join(dir, `${n}.pid`));
      const bin = path.join(dir, "wrapper.mjs");
      await writeFile(
        bin,
        `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(files[0])},String(process.pid));
const inner="const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('fs').writeFileSync("+JSON.stringify(${JSON.stringify(files[2])})+",String(c.pid));setInterval(()=>{},1000)";
const b=spawn(process.execPath,['-e',inner],{stdio:'ignore',detached:true});b.unref();
writeFileSync(${JSON.stringify(files[1])},String(b.pid));setInterval(()=>{},1000);`,
      );
      const child = spawnCli(bin, [], { cwd: dir });
      const closed = collect(child);
      for (const file of files) pids.push(Number(await waitFor(file)));
      killChildTree(child);
      const result = await closed;
      assert.notEqual(result.code, 0);
      for (const pid of pids) assert.ok(await gone(pid), `job member ${pid} must be stopped`);
      assert.ok(unrelated.pid && alive(unrelated.pid), "unrelated process must survive");
      // Ownership is per spawned handle: repeating the call or passing a
      // foreign child is a no-op.
      killChildTree(child);
      killChildTree(unrelated);
      assert.ok(alive(unrelated.pid!), "foreign child must not be killed");
    } finally {
      unrelated.kill();
      for (const pid of pids) if (alive(pid)) process.kill(pid);
      await rm(dir, { recursive: true, force: true });
    }
  },
);
