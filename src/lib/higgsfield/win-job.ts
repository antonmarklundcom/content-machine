/**
 * Windows process containment for CLI runs (R03).
 *
 * Node cannot create a Windows Job Object itself, so a short PowerShell
 * launcher does it: it creates a job that kills every member when its last
 * handle closes, starts the real command suspended, assigns it to the job,
 * checks the assignment, and only then lets it run. The launcher waits for that
 * command and exits with its exit code.
 *
 * The launcher holds the only job handle. Whether it exits normally (the
 * wrapper finished) or is terminated (timeout, output limit, cancel), Windows
 * closes that handle and ends every process still in the job, including
 * descendants that inherited the output pipes. No stored or numeric PID is
 * trusted; ownership is the kernel job.
 */

/** Exit code the launcher uses when containment could not be established. */
export const CONTAINMENT_FAILED_EXIT = 0x4a0b;
export const CONTAINMENT_FAILED_MARKER = "CM_CONTAINMENT_FAILED:";

/** Quote one argument for a normal (MSVCRT-parsed) Windows command line. */
export function msvcrtQuote(arg: string): string {
  if (arg !== "" && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let slashes = 0;
  for (const ch of arg) {
    if (ch === "\\") {
      slashes++;
      continue;
    }
    if (ch === '"') {
      out += "\\".repeat(slashes * 2 + 1) + '"';
    } else {
      out += "\\".repeat(slashes) + ch;
    }
    slashes = 0;
  }
  return out + "\\".repeat(slashes * 2) + '"';
}

const LAUNCHER_CS = String.raw`
using System;
using System.Runtime.InteropServices;
public static class CmJobLauncher {
  [StructLayout(LayoutKind.Sequential)] struct BASIC { public long a; public long b; public uint LimitFlags; public UIntPtr c; public UIntPtr d; public uint e; public UIntPtr f; public uint g; public uint h; }
  [StructLayout(LayoutKind.Sequential)] struct IOC { public ulong a; public ulong b; public ulong c; public ulong d; public ulong e; public ulong f; }
  [StructLayout(LayoutKind.Sequential)] struct EXT { public BASIC Basic; public IOC Io; public UIntPtr p1; public UIntPtr p2; public UIntPtr p3; public UIntPtr p4; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct SI { public int cb; public string r; public string d; public string t; public int x; public int y; public int w; public int h; public int cx; public int cy; public int fill; public int flags; public short show; public short r2; public IntPtr r3; public IntPtr hIn; public IntPtr hOut; public IntPtr hErr; }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr hProcess; public IntPtr hThread; public int pid; public int tid; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr a, string n);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr j, int c, ref EXT i, int l);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr p, IntPtr j, out bool r);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessW(string app, System.Text.StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref SI si, out PI pi);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr t);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr p, uint c);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr j, uint c);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr p, out uint c);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
  static int Fail(string step) {
    Console.Error.WriteLine("${CONTAINMENT_FAILED_MARKER}" + step + " (" + Marshal.GetLastWin32Error() + ")");
    Console.Error.Flush();
    return ${CONTAINMENT_FAILED_EXIT};
  }
  public static int Run(string commandLine) {
    IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
    if (job == IntPtr.Zero) return Fail("CreateJobObject");
    EXT info = new EXT();
    info.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (!SetInformationJobObject(job, 9, ref info, Marshal.SizeOf(typeof(EXT)))) return Fail("SetInformationJobObject");
    SI si = new SI();
    si.cb = Marshal.SizeOf(typeof(SI));
    si.flags = 0x100; // STARTF_USESTDHANDLES
    si.hIn = GetStdHandle(-10); si.hOut = GetStdHandle(-11); si.hErr = GetStdHandle(-12);
    PI pi;
    // CREATE_SUSPENDED: nothing runs before it is in the job. The console (hidden
    // by the caller) is shared, so descendants do not open windows of their own.
    if (!CreateProcessW(null, new System.Text.StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, true, 0x4, IntPtr.Zero, null, ref si, out pi)) return Fail("CreateProcess");
    bool inJob = false;
    if (!AssignProcessToJobObject(job, pi.hProcess) || !IsProcessInJob(pi.hProcess, job, out inJob) || !inJob) {
      TerminateProcess(pi.hProcess, ${CONTAINMENT_FAILED_EXIT});
      return Fail("AssignProcessToJobObject");
    }
    if (ResumeThread(pi.hThread) == 0xFFFFFFFF) { TerminateJobObject(job, ${CONTAINMENT_FAILED_EXIT}); return Fail("ResumeThread"); }
    WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
    uint code;
    if (!GetExitCodeProcess(pi.hProcess, out code)) code = 1;
    // The wrapper is done: end anything it left behind in the job.
    TerminateJobObject(job, code);
    return (int)code;
  }
}`;

/**
 * PowerShell source for the launcher. The command line travels as base64
 * inside the script, so it is never re-parsed by PowerShell. Standard input is
 * left untouched for the contained command.
 */
export function launcherScript(commandLine: string): string {
  const b64 = Buffer.from(commandLine, "utf16le").toString("base64");
  const cs = Buffer.from(LAUNCHER_CS, "utf16le").toString("base64");
  return [
    "$ErrorActionPreference='Stop'",
    "$ProgressPreference='SilentlyContinue'",
    `$c=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}'))`,
    // Any launcher-side failure is reported with the marker; the command is
    // then either never created or ended with the job.
    `try{Add-Type -TypeDefinition ([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${cs}')));$r=[CmJobLauncher]::Run($c)}catch{[Console]::Error.WriteLine('${CONTAINMENT_FAILED_MARKER}launcher '+$_.Exception.Message);exit ${CONTAINMENT_FAILED_EXIT}}`,
    // A plain exit is ~2 s faster than [Environment]::Exit on Windows PowerShell 5.1.
    "exit $r",
  ].join(";");
}

/** powershell.exe arguments that run the launcher for `commandLine`. */
export function launcherArgs(commandLine: string): string[] {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    Buffer.from(launcherScript(commandLine), "utf16le").toString("base64"),
  ];
}

/** The Windows PowerShell 5.1 executable, by absolute path (no PATH lookup). */
export function powershellPath(env: Record<string, string | undefined> = process.env): string {
  const root = env.SystemRoot || env.windir || "C:\\Windows";
  return `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}
