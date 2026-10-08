import { spawn, spawnSync, type ChildProcess } from "node:child_process";

/**
 * Starting, probing and killing the `claude` CLI (build 4 §1.14). Mirrors the
 * spawn in `src/lib/ai-cli.ts` (a `.cmd` shim on Windows needs a shell), plus:
 * a `.mjs`/`.js` "binary" runs under this Node (the tests' fake CLI), args are
 * quoted for cmd.exe, and a kill takes the whole process tree with it.
 */

const isWindows = process.platform === "win32";

/** One argument for cmd.exe: wrapped in quotes when it has anything special. */
export function winQuote(arg: string): string {
  if (arg && !/[\s"&|<>^(),;%!*]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

export type Invocation = { command: string; args: string[]; shell: boolean };

/** How to run `bin args…` on this platform. */
export function invocation(bin: string, args: string[]): Invocation {
  if (/\.(mjs|cjs|js)$/i.test(bin)) {
    return { command: process.execPath, args: [bin, ...args], shell: false };
  }
  if (isWindows) {
    return { command: winQuote(bin), args: args.map(winQuote), shell: true };
  }
  return { command: bin, args, shell: false };
}

/** Spawn with piped stdio in `cwd`. On POSIX the child leads its own group, so a kill reaches its MCP servers too. */
export function spawnCli(
  bin: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
): ChildProcess {
  const inv = invocation(bin, args);
  return spawn(inv.command, inv.args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    shell: inv.shell,
    detached: !isWindows,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Whether a process with this pid exists (EPERM = exists, owned by someone else). */
export function pidAlive(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Kill `pid` and its children. Never throws. */
export function killTree(pid: number | null | undefined): void {
  if (!pid || pid <= 0) return;
  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

/** Numeric PIDs from rows are forbidden here; only a still-live owned child handle may be killed. */
export function killChildTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || child.killed) return;
  killTree(child.pid);
}

export type ExecResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the program could not be started at all (not installed). */
  spawnError?: string;
  timedOut?: boolean;
};

/** Run a short command to completion and collect its output (preflight). */
export function execCli(
  bin: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const inv = invocation(bin, args);
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (r: ExecResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    let child: ChildProcess;
    try {
      child = spawn(inv.command, inv.args, {
        cwd: opts.cwd ?? process.cwd(),
        shell: inv.shell,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ code: null, stdout: "", stderr: "", spawnError: (error as Error).message });
      return;
    }
    const timer = setTimeout(() => {
      killTree(child.pid);
      child.kill();
      done({ code: null, stdout, stderr, timedOut: true });
    }, opts.timeoutMs ?? 60_000);
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (error) => done({ code: null, stdout, stderr, spawnError: error.message }));
    child.on("close", (code) => {
      // cmd.exe reports a missing program as exit 1 / 9009 with this text, not a spawn error.
      if (isWindows && /is not recognized as an internal or external command/i.test(stderr)) {
        done({ code, stdout, stderr, spawnError: stderr.trim() });
      } else done({ code, stdout, stderr });
    });
  });
}
