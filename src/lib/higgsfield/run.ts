import { buildVoiceRunPrompt } from "./voice-prompt";
import { insertReturning, updateReturning } from "@/db/mutations";
import "server-only";
import { isOnlineDeploy, PcOnlyError } from "@/lib/pc-only";

import type { ChildProcess } from "node:child_process";
import { and, desc, eq, inArray, lt, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  HIGGSFIELD_JOB_KINDS,
  higgsfieldJobs,
  leases,
  type HiggsfieldJob,
  type HiggsfieldJobKind,
} from "@/db/schema";
import { acquireLease, releaseLease, type Lease } from "@/lib/lease";
import { scanMediaRoot } from "@/lib/media/scan";
import { mediaRoot, mediaRootMessage, mediaRootStatus } from "@/lib/storage/root";

import { buildBriefArgument, HiggsfieldInputError, type BriefRequest } from "./brief";
import { claudeBin, jobTimeoutMs, MAX_CREDITS_LIMIT, TARGETED_KINDS } from "./config";
import { resolveMcpServers } from "./preflight";
import { killChildTree, spawnCli } from "./process";
import {
  buildRunPrompt,
  buildRecoveryRunPrompt,
  claudeRunArgs,
  extractArgument,
  type RecoveryInput,
} from "./prompt";
import { ownedByWorker, staleWorkerJob, workerIdentity } from "./ownership";
import { outputFolders } from "./output-folders";
import { StreamParser } from "./stream";
import {
  parseVoiceManifest,
  scanVoiceMarkers,
  VoiceMarkerCollector,
  type VoiceMarkers,
} from "./voice";

/**
 * The runner (build 4 §1.14): one `higgsfield_jobs` row per run, one headless
 * `claude -p … --output-format stream-json` child per row, spawned in the repo
 * so the `.claude/commands/higgsfield-*.md` slash commands resolve.
 *
 *   queued → running → done | failed | cancelled
 *
 * - **One run per target.** A `queued`/`running` row for the same target (or
 *   any import) refuses a second start, and a lease named after the target
 *   makes the check-and-insert race-free across processes (the page and
 *   `scripts/higgsfield-run.ts`).
 * - **Bounded.** `HIGGSFIELD_JOB_TIMEOUT_MIN` (default 30) kills the process
 *   tree and fails the row; cancel kills it and marks it `cancelled`.
 * - **Reaped.** Only stale identified work on this PC can be failed after its
 *   heartbeat and lease expire. Persisted numeric PIDs are never killed.
 * - After the run the media scan registers what was written, so the files are
 *   `assets` at once.
 */

export class HiggsfieldBusyError extends Error {
  constructor(readonly jobId: number | null) {
    super(
      jobId
        ? `Job #${jobId} is already running for this target. Wait for it or cancel it.`
        : "Another run for this target is starting. Try again in a moment.",
    );
    this.name = "HiggsfieldBusyError";
  }
}

export { HiggsfieldInputError };

export type StartInput = BriefRequest & {
  maxCredits: number;
  /** Re-use this argument instead of building a brief (retry of `free`/`import`). */
  argument?: string;
  /** Internal retry: recover retained remote work without any new submission. */
  recovery?: RecoveryInput & { outputPaths?: string[] };
};

export type StartOptions = {
  /** Where `claude` runs; the repo root (default `process.cwd()`). */
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Internal durable plan: writes linked rows and returns the argument in the job transaction. */
  prepareArgument?: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    jobId: number,
  ) => Promise<string>;
};

export type Started = { job: HiggsfieldJob; finished: Promise<HiggsfieldJob> };

type Handle = { child: ChildProcess; cancelled: boolean };

/** Runs supervised by this process. */
const handles = new Map<number, Handle>();
/** Their `finished` promises, until they settle (scan and lease release included). */
const inflight = new Set<Promise<unknown>>();

/** Resolves once every run this process supervises has fully finished (tests, the CLI). */
export async function settleRuns(): Promise<void> {
  while (inflight.size) await Promise.allSettled([...inflight]);
}

const ACTIVE = ["queued", "running"] as const;
const WORKER_GRACE_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 30_000;

function ownedJobWhere(id: number, ...conditions: Array<SQL | undefined>) {
  return and(
    eq(higgsfieldJobs.id, id),
    eq(higgsfieldJobs.workerHost, workerIdentity.host),
    eq(higgsfieldJobs.workerInstance, workerIdentity.instance),
    ...conditions,
  );
}

/** Lease name serialising runs for one target (`import` is one target); `free` runs are not serialised. */
export function concurrencyKey(kind: HiggsfieldJobKind, targetRef: string | null): string | null {
  if (targetRef) return `higgsfield:${targetRef}`;
  if (kind === "import") return "higgsfield:import";
  return null;
}

export function validateMaxCredits(kind: HiggsfieldJobKind, value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0)
    throw new HiggsfieldInputError("The credit ceiling must be a number.");
  if (kind !== "import" && n <= 0)
    throw new HiggsfieldInputError("Set a credit ceiling above 0 for a run that generates.");
  if (n > MAX_CREDITS_LIMIT)
    throw new HiggsfieldInputError(`A single run may spend at most ${MAX_CREDITS_LIMIT} credits.`);
  return Math.round(n * 100) / 100;
}

/** The env handed to `claude`: the app's own secrets stay behind (Claude's own auth vars pass). */
export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (/^(CLAUDE|ANTHROPIC)_/.test(key)) out[key] = value;
    else if (/SECRET|TOKEN|PASSWORD|DATABASE_URL|API_KEY|_KEY$/i.test(key)) continue;
    else out[key] = value;
  }
  return out as NodeJS.ProcessEnv;
}

export async function getJob(id: number): Promise<HiggsfieldJob | null> {
  const [row] = await db.select().from(higgsfieldJobs).where(eq(higgsfieldJobs.id, id)).limit(1);
  return row ?? null;
}

export async function listJobs(limit = 50): Promise<HiggsfieldJob[]> {
  return db
    .select()
    .from(higgsfieldJobs)
    .orderBy(desc(higgsfieldJobs.id))
    .limit(Math.max(1, Math.min(200, limit)));
}

async function activeJobFor(kind: HiggsfieldJobKind, targetRef: string | null) {
  const where = targetRef
    ? eq(higgsfieldJobs.targetRef, targetRef)
    : kind === "import"
      ? eq(higgsfieldJobs.kind, "import")
      : null;
  if (!where) return null;
  const [row] = await db
    .select({ id: higgsfieldJobs.id })
    .from(higgsfieldJobs)
    .where(and(where, inArray(higgsfieldJobs.status, [...ACTIVE])))
    .limit(1);
  return row ?? null;
}

/**
 * Create the row and spawn the run. Resolves once the process is started (or
 * failed to start); `finished` resolves with the final row.
 */
export async function startJob(input: StartInput, opts: StartOptions = {}): Promise<Started> {
  if (isOnlineDeploy()) throw new HiggsfieldInputError(new PcOnlyError("A Higgsfield run").message);
  if (!HIGGSFIELD_JOB_KINDS.includes(input.kind))
    throw new HiggsfieldInputError(`Unknown kind ${String(input.kind)}.`);
  const maxCredits = input.recovery ? 0 : validateMaxCredits(input.kind, input.maxCredits);
  if (TARGETED_KINDS.includes(input.kind) && !input.targetRef)
    throw new HiggsfieldInputError("This kind needs a target.");

  await reapJobs();

  const built =
    input.argument !== undefined
      ? {
          argument: input.argument,
          brandId: input.brandId ?? null,
          targetRef: input.targetRef ?? null,
        }
      : await buildBriefArgument(input);
  const brandId = input.brandId?.trim() || built.brandId;

  const key =
    concurrencyKey(input.kind, built.targetRef) ??
    (input.recovery ? `higgsfield:recovery:${input.recovery.sourceJobId}` : null);
  const timeoutMs = jobTimeoutMs();
  let lease: Lease | null = null;
  if (key) {
    const active = await activeJobFor(input.kind, built.targetRef);
    if (active) throw new HiggsfieldBusyError(active.id);
    lease = await acquireLease(key, timeoutMs + 5 * 60 * 1000);
    if (!lease) throw new HiggsfieldBusyError(null);
  }

  let job: HiggsfieldJob;
  try {
    job = await db.transaction(async (tx) => {
      const [inserted] = await insertReturning(tx, higgsfieldJobs, {
        kind: input.kind,
        targetRef: built.targetRef,
        brandId,
        prompt: "(building)",
        maxCredits,
        workerHost: workerIdentity.host,
        workerInstance: workerIdentity.instance,
        heartbeatAt: new Date(),
        leaseName: lease?.name ?? null,
        leaseHolder: lease?.holder ?? null,
        recoveryOfJobId: input.recovery?.sourceJobId ?? null,
        externalJobIds: input.recovery?.externalJobIds ?? [],
        outputPaths: input.recovery?.outputPaths ?? [],
      });
      const root = mediaRoot();
      const argument = opts.prepareArgument
        ? await opts.prepareArgument(tx, inserted.id)
        : built.argument;
      const prompt = input.recovery
        ? buildRecoveryRunPrompt({
            kind: input.kind,
            jobId: inserted.id,
            argument,
            maxCredits,
            mediaRoot: root,
            recovery: input.recovery,
          })
        : input.kind === "voice"
          ? buildVoiceRunPrompt({
              jobId: inserted.id,
              argument,
              maxCredits,
              mediaRoot: root,
            })
          : buildRunPrompt({
              kind: input.kind,
              jobId: inserted.id,
              argument,
              maxCredits,
              mediaRoot: root,
            });
      const [prepared] = await updateReturning(
        tx,
        higgsfieldJobs,
        { prompt },
        eq(higgsfieldJobs.id, inserted.id),
      );
      return prepared;
    });
  } catch (error) {
    if (lease) await releaseLease(lease);
    throw error;
  }

  const fail = async (message: string): Promise<Started> => {
    const [row] = await updateReturning(
      db,
      higgsfieldJobs,
      { status: "failed", error: message.slice(0, 1000), finishedAt: new Date() },
      ownedJobWhere(job.id),
    );
    if (lease) await releaseLease(lease);
    return { job: row, finished: Promise.resolve(row) };
  };

  const drive = await mediaRootStatus();
  if (drive !== "ok") return fail(mediaRootMessage(drive));

  let mcpServers: string[];
  try {
    mcpServers = await resolveMcpServers();
  } catch {
    mcpServers = ["higgsfield"];
  }
  return supervise(job, {
    lease,
    timeoutMs,
    recovery: input.recovery,
    cwd: opts.cwd ?? process.cwd(),
    env: childEnv(opts.env ?? process.env),
    args: claudeRunArgs({
      mediaRoot: mediaRoot(),
      mcpServers,
      recoveryOnly: !!input.recovery,
      model: process.env.HIGGSFIELD_CLAUDE_MODEL || undefined,
    }),
  });
}

function supervise(
  job: HiggsfieldJob,
  ctx: {
    lease: Lease | null;
    timeoutMs: number;
    cwd: string;
    env: NodeJS.ProcessEnv;
    args: string[];
    recovery?: RecoveryInput;
  },
): Promise<Started> {
  const id = job.id;
  const parser = new StreamParser(mediaRoot());
  // Build 5: a voice run prints `HF_JOB <lineId> <jobId>`; read those here.
  const voice = job.kind === "voice" ? new VoiceMarkerCollector() : null;
  if (voice && ctx.recovery) {
    Object.assign(voice.markers.jobs, ctx.recovery.voiceJobs ?? {});
    voice.markers.jobIds.push(...ctx.recovery.externalJobIds);
  }
  const bin = claudeBin();
  parser.note(
    `[start] ${bin} ${ctx.args.slice(0, 4).join(" ")} … (ceiling ${job.maxCredits} credits)`,
  );

  // Every write for this job goes through one chain, so a fast exit can never
  // land before the "running" update.
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  const progress = () => ({
    log: parser.state.log,
    externalJobIds: [
      ...new Set([
        ...job.externalJobIds,
        ...(voice ? voice.markers.jobIds : parser.state.externalJobIds),
      ]),
    ],
    outputPaths: [...new Set([...job.outputPaths, ...parser.state.outputPaths])],
    creditsUsed: parser.state.creditsUsed,
    heartbeatAt: new Date(),
  });

  let flushTimer: NodeJS.Timeout | null = null;
  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void enqueue(() =>
        db
          .update(higgsfieldJobs)
          .set(progress())
          .where(ownedJobWhere(id, eq(higgsfieldJobs.status, "running"))),
      ).catch(() => {});
    }, 1000);
  };

  const heartbeat = setInterval(() => {
    void enqueue(() =>
      db
        .update(higgsfieldJobs)
        .set({ heartbeatAt: new Date() })
        .where(ownedJobWhere(id, inArray(higgsfieldJobs.status, [...ACTIVE]))),
    ).catch(() => {});
  }, HEARTBEAT_MS);
  heartbeat.unref();

  let child: ChildProcess;
  try {
    child = spawnCli(bin, ctx.args, { cwd: ctx.cwd, env: ctx.env });
  } catch (error) {
    clearInterval(heartbeat);
    return finishEarly((error as Error).message);
  }
  const handle: Handle = { child, cancelled: false };
  handles.set(id, handle);

  let resolveStarted!: (job: HiggsfieldJob) => void;
  const started = new Promise<HiggsfieldJob>((r) => (resolveStarted = r));
  let resolveFinished!: (job: HiggsfieldJob) => void;
  const finished = new Promise<HiggsfieldJob>((r) => (resolveFinished = r));
  inflight.add(finished);
  void finished.finally(() => inflight.delete(finished));

  let spawned = false;
  let settled = false;
  let timedOut = false;
  let stderrTail = "";

  const timer = setTimeout(() => {
    timedOut = true;
    parser.note(
      `[timeout] no end after ${Math.round(ctx.timeoutMs / 60000)} min — killing the run`,
    );
    killChildTree(child);
    setTimeout(() => child.kill("SIGKILL"), 5000).unref();
  }, ctx.timeoutMs);

  child.on("spawn", () => {
    spawned = true;
    void enqueue(async () => {
      const [row] = await updateReturning(
        db,
        higgsfieldJobs,
        {
          status: "running",
          pid: child.pid ?? null,
          startedAt: new Date(),
          log: parser.state.log,
        },
        ownedJobWhere(id, eq(higgsfieldJobs.status, "queued")),
      );
      resolveStarted(row ?? (await getJob(id))!);
    });
  });

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    voice?.feed(chunk);
    if (parser.feed(chunk)) scheduleFlush();
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-2000);
  });

  const finalize = (code: number | null, spawnError?: string) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    clearInterval(heartbeat);
    if (flushTimer) clearTimeout(flushTimer);
    handles.delete(id);
    parser.end();
    voice?.end();
    const s = parser.state;

    let status: "done" | "failed" | "cancelled";
    let error: string | null = null;
    if (handle.cancelled) {
      status = "cancelled";
      error = "Cancelled.";
    } else if (spawnError) {
      status = "failed";
      error = `Could not start "${bin}" (${spawnError.replace(/\s+/g, " ")}). Is Claude Code installed and logged in? See docs/HIGGSFIELD.md.`;
    } else if (timedOut) {
      status = "failed";
      error = `Timed out after ${Math.round(ctx.timeoutMs / 60000)} min; the run was killed. Higgsfield jobs already submitted are listed, so a retry can skip them.`;
    } else if (code === 0 && !s.isError) {
      status = "done";
    } else {
      status = "failed";
      error =
        (s.isError && s.resultText) ||
        stderrTail.trim() ||
        (code === null ? "The run was killed." : `claude exited with code ${code}.`);
    }
    if (stderrTail.trim() && status !== "done")
      parser.note(`[stderr] ${stderrTail.trim().slice(-600)}`);
    if (s.creditsUsed !== null && s.creditsUsed > job.maxCredits)
      parser.note(
        `[warning] reported ${s.creditsUsed} credits, above the ceiling of ${job.maxCredits}`,
      );
    parser.note(`[end] ${status}${code !== null ? ` (exit ${code})` : ""}`);

    void enqueue(async () => {
      const now = new Date();
      const updated = await updateReturning(
        db,
        higgsfieldJobs,
        { ...progress(), status, error: error?.slice(0, 1000) ?? null, finishedAt: now },
        ownedJobWhere(id, inArray(higgsfieldJobs.status, [...ACTIVE])),
      );
      if (!updated.length) {
        // Cancelled (or reaped) from elsewhere: keep that status, still keep the output.
        await db
          .update(higgsfieldJobs)
          .set({ ...progress(), finishedAt: now })
          .where(ownedJobWhere(id));
      }
      if (voice) {
        // Turn the files into takes before the scan, so the scan finds them registered.
        await finalizeVoice(id, voice.markers, (line) => parser.note(line));
        await db.update(higgsfieldJobs).set({ log: parser.state.log }).where(ownedJobWhere(id));
      }
      const recovered = await reconcileOutputs({ ...job, outputPaths: progress().outputPaths });
      for (const line of recovered.notes)
        if (
          line !== "[reconcile] completed" ||
          !parser.state.log.includes("[voice] finalize failed")
        )
          parser.note(line);
      for (const file of recovered.paths)
        if (!s.outputPaths.includes(file)) s.outputPaths.push(file);
      await db.update(higgsfieldJobs).set(progress()).where(ownedJobWhere(id));
    })
      .catch(() => {})
      .finally(async () => {
        if (ctx.lease) await releaseLease(ctx.lease).catch(() => {});
        const row = (await getJob(id))!;
        resolveStarted(row);
        resolveFinished(row);
      });
  };

  child.on("error", (error) => {
    if (!spawned) finalize(null, error.message);
  });
  child.on("close", (code) =>
    finalize(
      code,
      process.platform === "win32" &&
        /is not recognized as an internal or external command/i.test(stderrTail)
        ? stderrTail.trim()
        : undefined,
    ),
  );

  child.stdin?.on("error", () => {});
  child.stdin?.end(job.prompt);

  return started.then((row) => ({ job: row, finished }));

  async function finishEarly(message: string): Promise<Started> {
    const [row] = await updateReturning(
      db,
      higgsfieldJobs,
      { status: "failed", error: message.slice(0, 1000), finishedAt: new Date() },
      ownedJobWhere(id),
    );
    if (ctx.lease) await releaseLease(ctx.lease);
    return { job: row, finished: Promise.resolve(row) };
  }
}

/** Cancel only the child this worker instance actually supervises. */
export async function cancelJob(id: number): Promise<HiggsfieldJob | null> {
  const job = await getJob(id);
  if (!job || !(ACTIVE as readonly string[]).includes(job.status)) return null;
  const handle = handles.get(id);
  if (isOnlineDeploy() || !ownedByWorker(job) || !handle)
    throw new HiggsfieldInputError(
      "Cancel this job on its owning PC worker. This process cannot verify its child.",
    );
  const [row] = await updateReturning(
    db,
    higgsfieldJobs,
    { status: "cancelled", error: "Cancelled.", finishedAt: new Date() },
    ownedJobWhere(id, inArray(higgsfieldJobs.status, [...ACTIVE])),
  );
  if (row && handles.get(id) === handle) {
    handle.cancelled = true;
    killChildTree(handle.child);
  }
  return row ?? (await getJob(id));
}

/** Retained remote IDs force a new, zero-credit recovery attempt with exact input lineage. */
export async function retryJob(
  id: number,
  maxCredits?: number,
  opts: StartOptions = {},
): Promise<Started> {
  const job = await getJob(id);
  if (!job) throw new HiggsfieldInputError(`No job ${id}.`);
  if ((ACTIVE as readonly string[]).includes(job.status)) throw new HiggsfieldBusyError(job.id);
  const voiceMarkers = job.kind === "voice" ? scanVoiceMarkers(job.log ?? "") : null;
  const remoteIds = [...new Set([...job.externalJobIds, ...(voiceMarkers?.jobIds ?? [])])];
  const recovery = remoteIds.length
    ? {
        sourceJobId: job.id,
        externalJobIds: remoteIds,
        voiceJobs: voiceMarkers?.jobs,
        outputPaths: job.outputPaths,
      }
    : undefined;
  const reuse = !!recovery || job.kind === "free" || job.kind === "import";
  const argument = reuse ? extractArgument(job.prompt) : null;
  if (reuse && argument === null)
    throw new HiggsfieldInputError(
      `Job ${id} cannot be retried safely. Review its retained provider IDs.`,
    );
  if (job.kind === "voice" && !recovery)
    throw new HiggsfieldInputError(
      "Retry voice lines from their studio after reviewing provider history.",
    );
  const retryOptions: StartOptions =
    recovery && job.kind === "voice"
      ? {
          ...opts,
          prepareArgument: async (tx, newJobId) => {
            const { narrations } = await import("@/db/schema");
            const ids = parseVoiceManifest(argument!)?.lines.map((line) => line.lineId) ?? [];
            if (ids.length)
              await tx
                .update(narrations)
                .set({ status: "pending", error: null, higgsfieldJobId: newJobId })
                .where(
                  and(
                    inArray(narrations.id, ids),
                    eq(narrations.higgsfieldJobId, job.id),
                    eq(narrations.status, "failed"),
                  ),
                );
            return argument!;
          },
        }
      : recovery
        ? { ...opts, prepareArgument: undefined }
        : opts;
  return startJob(
    {
      kind: job.kind,
      targetRef: job.targetRef,
      brandId: job.brandId,
      maxCredits: recovery ? 0 : (maxCredits ?? job.maxCredits),
      ...(reuse ? { argument: argument! } : {}),
      recovery,
    },
    retryOptions,
  );
}

/** Fail identified same-host stale work; never kill a persisted numeric PID. */
export async function reapJobs(now = new Date()): Promise<number[]> {
  if (isOnlineDeploy()) return [];
  const rows = await db
    .select()
    .from(higgsfieldJobs)
    .where(
      and(
        eq(higgsfieldJobs.workerHost, workerIdentity.host),
        inArray(higgsfieldJobs.status, [...ACTIVE]),
        lt(higgsfieldJobs.heartbeatAt, new Date(now.getTime() - WORKER_GRACE_MS)),
      ),
    );
  const reaped: number[] = [];
  for (const row of rows) {
    if (handles.has(row.id) || !staleWorkerJob(row, now, WORKER_GRACE_MS)) continue;
    if (row.leaseName && row.leaseHolder) {
      const [held] = await db.select().from(leases).where(eq(leases.name, row.leaseName)).limit(1);
      if (held?.holder === row.leaseHolder && held.expiresAt.getTime() > now.getTime()) continue;
    }
    const error =
      "The owning worker stopped heartbeating. Retained provider jobs require recovery before any replacement generation.";
    const [updated] = await updateReturning(
      db,
      higgsfieldJobs,
      { status: "failed", error, finishedAt: now },
      and(
        eq(higgsfieldJobs.id, row.id),
        eq(higgsfieldJobs.status, row.status),
        eq(higgsfieldJobs.workerHost, row.workerHost!),
        eq(higgsfieldJobs.workerInstance, row.workerInstance!),
        eq(higgsfieldJobs.heartbeatAt, row.heartbeatAt!),
      ),
      { id: higgsfieldJobs.id },
    );
    if (!updated) continue;
    reaped.push(row.id);
    if (row.leaseName && row.leaseHolder)
      await releaseLease({ name: row.leaseName, holder: row.leaseHolder });
    await reconcileTerminal({ ...row, status: "failed", error, finishedAt: now });
  }
  // This PC can recover only its own files; hosted page views never reconcile PC work.
  const terminal = await db
    .select()
    .from(higgsfieldJobs)
    .where(
      and(
        eq(higgsfieldJobs.workerHost, workerIdentity.host),
        inArray(higgsfieldJobs.status, ["done", "failed", "cancelled"]),
      ),
    );
  for (const row of terminal)
    if (!(row.log ?? "").includes("[reconcile] completed")) await reconcileTerminal(row);
  const { repairOrphanedHiggsfieldTakes } = await import("@/lib/voice/higgsfield-takes");
  await repairOrphanedHiggsfieldTakes(now);
  return reaped;
}

async function reconcileOutputs(job: HiggsfieldJob): Promise<{ paths: string[]; notes: string[] }> {
  const paths = new Set(job.outputPaths);
  const notes: string[] = [];
  let complete = true;
  const folders = outputFolders(job);
  for (const folder of folders) {
    try {
      const scan = await scanMediaRoot({
        folder,
        meta: { brandId: job.brandId, source: "higgsfield" },
      });
      if (scan.status === "ok") {
        for (const file of scan.registeredPaths) paths.add(file);
        notes.push(
          `[scan] ${folder}: ${scan.created} new, ${scan.existing} existing, ${scan.errors.length} error(s)`,
        );
        if (scan.errors.length) complete = false;
      } else {
        notes.push(`[scan] ${folder}: ${scan.message}`);
        complete = false;
      }
    } catch (error) {
      complete = false;
      notes.push(`[scan] ${folder}: ${(error as Error).message}`);
    }
  }
  if (!folders.length)
    notes.push(
      "[scan] No safe output folder in this stored request; use library Scan now to recover legacy files.",
    );
  if (complete) notes.push("[reconcile] completed");
  return { paths: [...paths], notes };
}

async function reconcileTerminal(job: HiggsfieldJob): Promise<void> {
  const notes: string[] = [];
  if (job.kind === "voice") await finalizeVoice(job.id, null, (line) => notes.push(line));
  const recovered = await reconcileOutputs(job);
  notes.push(
    ...recovered.notes.filter(
      (line) =>
        line !== "[reconcile] completed" ||
        !notes.some((note) => note.includes("[voice] finalize failed")),
    ),
  );
  await db
    .update(higgsfieldJobs)
    .set({
      outputPaths: recovered.paths,
      log: `${job.log ?? ""}\n${notes.join("\n")}`.slice(-32000),
    })
    .where(and(eq(higgsfieldJobs.id, job.id), eq(higgsfieldJobs.status, job.status)));
}

/**
 * The finalize hook for kind `voice` (build 5 §3.A): each line's file becomes
 * a take (src/lib/voice/higgsfield-takes.ts). Loaded lazily: that module
 * starts voice jobs through this one. Never throws; the outcome goes to `note`.
 */
async function finalizeVoice(
  jobId: number,
  markers: VoiceMarkers | null,
  note: (line: string) => void,
): Promise<void> {
  try {
    const { finalizeHiggsfieldVoiceJob } = await import("@/lib/voice/higgsfield-takes");
    const r = await finalizeHiggsfieldVoiceJob(jobId, markers);
    note(
      `[voice] ${r.done.length} take(s) made, ${r.failed.length} failed, ${r.selected.length} selected`,
    );
    for (const n of r.notes) note(`[voice] ${n}`);
  } catch (e) {
    note(`[voice] finalize failed: ${(e as Error).message}`);
  }
}

/** Jobs for one target, newest first (the generate button's status). */
export async function jobsForTarget(targetRef: string, limit = 5): Promise<HiggsfieldJob[]> {
  return db
    .select()
    .from(higgsfieldJobs)
    .where(eq(higgsfieldJobs.targetRef, targetRef))
    .orderBy(desc(higgsfieldJobs.id))
    .limit(limit);
}
