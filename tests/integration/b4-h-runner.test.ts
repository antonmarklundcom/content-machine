import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { GET as getJobRoute } from "@/app/api/higgsfield/jobs/[id]/route";
import {
  cancelHiggsfieldJobAction,
  retryHiggsfieldJobAction,
  startHiggsfieldJobAction,
} from "@/lib/higgsfield.actions";
import { resetPreflightCache } from "@/lib/higgsfield/preflight";
import { pidAlive } from "@/lib/higgsfield/process";
import { workerIdentity } from "@/lib/higgsfield/ownership";
import { extractArgument, rulePath } from "@/lib/higgsfield/prompt";
import {
  cancelJob,
  getJob,
  HiggsfieldBusyError,
  HiggsfieldInputError,
  reapJobs,
  retryJob,
  settleRuns,
  startJob,
} from "@/lib/higgsfield/run";
import { acquireLease } from "@/lib/lease";
import type { PostDraft } from "@/lib/posts/contract";

import { callRoute, signIn } from "./route";
import { resetTables, teardown } from "./setup";

/**
 * Phase H (docs/PLAN-build4.md §1.14): the Higgsfield runner against a fake
 * `claude` (`tests/fixtures/fake-claude-higgsfield.mjs`) — no Claude, no
 * Higgsfield, no network. Covers the lifecycle (done, failed exit, crash,
 * timeout, cancel), the inline brief, the one-run-per-target guard, the
 * reaper, the media scan after a run, and the owner gate on the actions/route.
 */

const FAKE = path.resolve("tests/fixtures/fake-claude-higgsfield.mjs");
const ENV_KEYS = [
  "APP_MODE",
  "MEDIA_ROOT",
  "CLAUDE_CLI_PATH",
  "CLAUDE_CLI_BIN",
  "HIGGSFIELD_MCP_SERVER",
  "HIGGSFIELD_JOB_TIMEOUT_MIN",
  "FAKE_CLAUDE_MODE",
  "FAKE_CLAUDE_FILE",
  "FAKE_CLAUDE_LOG",
  "FAKE_CLAUDE_MCP",
];

let base = "";
let root = "";
let log = "";
let owner = "";
let employee = "";

const { workAsyncStorage } = createRequire(import.meta.url)(
  "next/dist/server/app-render/work-async-storage.external",
) as { workAsyncStorage: { getStore(): Record<string, unknown> | undefined } };

async function as<T>(cookie: string, action: () => Promise<T>): Promise<T> {
  let result: T | undefined;
  let error: unknown;
  await callRoute(
    async () => {
      workAsyncStorage.getStore()!.incrementalCache = {};
      try {
        result = await action();
      } catch (e) {
        error = e;
      }
      return new Response(null);
    },
    new Request("http://localhost/higgsfield", { method: "POST", headers: { cookie } }),
  );
  if (error) throw error;
  return result as T;
}

function calls(): { args: string[]; stdin: string }[] {
  return existsSync(log)
    ? readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { args: string[]; stdin: string })
    : [];
}

function draft(): PostDraft {
  return {
    version: 1,
    format: "carousel",
    language: "en",
    hook: "h",
    caption: "c",
    cta: "cta",
    hashtags: [],
    engagement: { mechanic: "save", detail: "d" },
    slides: [
      {
        n: 1,
        headline: "Cedula in 45 days",
        body: "",
        visual: { prompt: "a passport on a desk", textOverlay: "" },
      },
      { n: 2, headline: "Step two", body: "", visual: { prompt: "a stamp", textOverlay: "" } },
    ],
    sources: [],
  };
}

async function makePost(): Promise<number> {
  const [account] = await insertReturning(db, schema.socialAccounts, {
    brandId: "guide",
    platform: "instagram",
    handle: "guide_en",
    status: "active",
  });
  const [post] = await insertReturning(db, schema.posts, {
    accountId: account.id,
    brandId: "guide",
    format: "carousel",
    status: "drafting",
    title: "Cedula in 45 days",
    body: draft(),
  });
  return post.id;
}

beforeEach(async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  resetPreflightCache();
  base = mkdtempSync(path.join(tmpdir(), "b4h-"));
  root = path.join(base, "drive");
  mkdirSync(root);
  log = path.join(base, "claude.log");
  process.env.MEDIA_ROOT = root;
  process.env.CLAUDE_CLI_PATH = FAKE;
  process.env.HIGGSFIELD_MCP_SERVER = "higgsfield";
  process.env.FAKE_CLAUDE_LOG = log;
  await resetTables();
  await db.insert(schema.brands).values({
    id: "guide",
    name: "Guide",
    domain: "guide.example",
    niche: "residency",
    market: "paraguay",
    platforms: ["instagram"],
  });
  owner = (await signIn("owner")).cookie;
  employee = (await signIn("employee")).cookie;
});

afterEach(async () => {
  await settleRuns();
  if (base) rmSync(base, { recursive: true, force: true });
});

after(async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  await teardown();
});

test("a free run: queued → running → done, with job ids, files, credits and a media scan", async () => {
  const started = await startJob({
    kind: "free",
    brandId: "guide",
    description: "three photos of the Asunción skyline at dusk",
    maxCredits: 10,
  });
  assert.equal(started.job.status, "running");
  assert.ok(started.job.pid && started.job.pid > 0);
  assert.ok(started.job.startedAt);

  const job = await started.finished;
  assert.equal(job.status, "done", job.error ?? job.log ?? "");
  assert.deepEqual(job.externalJobIds, ["abc12345"]);
  assert.deepEqual(job.outputPaths, ["_inbox/higgsfield/2026-10-07/fake-abc12345.png"]);
  assert.equal(job.creditsUsed, 6);
  assert.equal(job.brandId, "guide");
  assert.ok(job.finishedAt);
  assert.match(job.log ?? "", /\[init\] MCP higgsfield: connected/);
  assert.match(job.log ?? "", /\[scan\].*: 1 new/);

  // The file is an asset at once.
  const [asset] = await db
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.source, "higgsfield"));
  assert.ok(asset, "registered by the scan");
  assert.match(asset.localPath ?? "", /^_originals\//);

  // What the CLI got: headless stream-json, narrow permissions, the prompt on stdin.
  const [call] = calls();
  assert.deepEqual(call.args.slice(0, 4), ["-p", "--output-format", "stream-json", "--verbose"]);
  const allowed = call.args[call.args.indexOf("--allowedTools") + 1];
  assert.ok(allowed.startsWith("mcp__higgsfield,Read(/"));
  assert.ok(allowed.includes(`Write(${rulePath(root)}/**)`));
  const downloader = `node "${path.resolve("scripts/media-download.mjs").replaceAll("\\", "/")}" "${root.replaceAll("\\", "/")}"`;
  assert.deepEqual(
    allowed.split(",").filter((rule) => rule.startsWith("Bash(")),
    [`Bash(${downloader} :*)`],
  );
  assert.ok(call.stdin.includes(`${downloader} "<path relative to MEDIA_ROOT>"`));
  assert.ok(call.stdin.startsWith("/higgsfield-free # Free prompt — Guide"));
  assert.ok(call.stdin.includes("three photos of the Asunción skyline at dusk"));
  assert.ok(
    call.stdin.includes("Spend at most 10 credits: check balance first, preflight with get_cost"),
  );
  assert.ok(call.stdin.includes(`job #${job.id}`));
  assert.equal(job.prompt, call.stdin);
});

test("a post run inlines the post's generation brief", async () => {
  const postId = await makePost();
  const started = await startJob({ kind: "post", targetRef: `post:${postId}`, maxCredits: 15 });
  const job = await started.finished;
  assert.equal(job.status, "done");
  assert.equal(job.brandId, "guide");
  assert.equal(job.targetRef, `post:${postId}`);
  const [call] = calls();
  assert.ok(call.stdin.startsWith(`/higgsfield-post # Generation brief — post ${postId}`));
  assert.ok(call.stdin.includes("a passport on a desk"));
  assert.match(
    call.stdin,
    new RegExp(
      `guide/guide-en/\\d{4}-\\d{2}/${postId}-cedula-in-45-days/01-cedula-in-45-days\\.png`,
    ),
  );
  assert.ok(call.stdin.includes('"postId":') || call.stdin.includes('"postId": '));

  await assert.rejects(
    startJob({ kind: "post", targetRef: "post:999", maxCredits: 5 }),
    HiggsfieldInputError,
  );
  await assert.rejects(
    startJob({ kind: "post", targetRef: `post:${postId}`, maxCredits: 0 }),
    /above 0/,
  );
});

test("a failed result marks the run failed with the CLI's error", async () => {
  process.env.FAKE_CLAUDE_MODE = "fail";
  const job = await (await startJob({ kind: "import", maxCredits: 0 })).finished;
  assert.equal(job.status, "failed");
  assert.equal(job.error, "Higgsfield refused the batch: insufficient credits");
  assert.ok(calls()[0].stdin.startsWith("/higgsfield-import "));
});

test("a crash (non-zero exit, no result) keeps stderr as the error", async () => {
  process.env.FAKE_CLAUDE_MODE = "crash";
  const job = await (await startJob({ kind: "import", range: "last 5", maxCredits: 0 })).finished;
  assert.equal(job.status, "failed");
  assert.match(job.error ?? "", /something broke inside the CLI/);
  assert.match(job.log ?? "", /\[end\] failed \(exit 3\)/);
});

test("a run past the timeout is killed and failed", async () => {
  process.env.FAKE_CLAUDE_MODE = "hang";
  process.env.HIGGSFIELD_JOB_TIMEOUT_MIN = String(1.5 / 60);
  const started = await startJob({ kind: "import", maxCredits: 0 });
  const job = await started.finished;
  assert.equal(job.status, "failed");
  assert.match(job.error ?? "", /Timed out after/);
  assert.equal(pidAlive(job.pid), false);
});

test("cancel kills the run and marks it cancelled; the target is free again", async () => {
  process.env.FAKE_CLAUDE_MODE = "hang";
  const postId = await makePost();
  const ref = `post:${postId}`;
  const started = await startJob({ kind: "post", targetRef: ref, maxCredits: 5 });
  assert.equal(started.job.status, "running");

  // One run per target.
  await assert.rejects(startJob({ kind: "post", targetRef: ref, maxCredits: 5 }), (e: unknown) => {
    assert.ok(e instanceof HiggsfieldBusyError);
    assert.equal(e.jobId, started.job.id);
    return true;
  });

  // Progress reaches the row while the run is still going.
  for (let i = 0; i < 60 && !(await getJob(started.job.id))?.log?.includes("Waiting on jobs"); i++)
    await new Promise((r) => setTimeout(r, 100));
  assert.equal((await getJob(started.job.id))?.status, "running");

  const cancelled = await cancelJob(started.job.id);
  assert.equal(cancelled?.status, "cancelled");
  const job = await started.finished;
  assert.equal(job.status, "cancelled");
  assert.match(job.log ?? "", /Waiting on jobs/);
  assert.equal(pidAlive(job.pid), false);
  assert.equal(await cancelJob(job.id), null, "a finished run cannot be cancelled");

  process.env.FAKE_CLAUDE_MODE = "done";
  const again = await (await startJob({ kind: "post", targetRef: ref, maxCredits: 5 })).finished;
  assert.equal(again.status, "done");
});

test("a held lease refuses a concurrent start without a row", async () => {
  const lease = await acquireLease("higgsfield:import", 60_000);
  assert.ok(lease);
  await assert.rejects(startJob({ kind: "import", maxCredits: 0 }), (e: unknown) => {
    assert.ok(e instanceof HiggsfieldBusyError);
    assert.equal(e.jobId, null);
    return true;
  });
  assert.equal((await db.select().from(schema.higgsfieldJobs)).length, 0);
});

test("the PC reaper fails stale owned work while preserving foreign work and successor leases", async () => {
  const now = new Date();
  const staleAt = new Date(now.getTime() - 20 * 60 * 1000);
  const expiredAt = new Date(now.getTime() - 60_000);
  const future = new Date(now.getTime() + 60 * 60 * 1000);
  const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
  const owned = {
    kind: "free" as const,
    prompt: "x",
    maxCredits: 1,
    status: "running" as const,
    workerHost: workerIdentity.host,
    workerInstance: "stopped-test-worker",
    heartbeatAt: staleAt,
  };
  await db.insert(schema.leases).values([
    { name: "higgsfield:import", holder: "stopped-import-holder", expiresAt: expiredAt },
    { name: "higgsfield:protected", holder: "live-holder", expiresAt: future },
    { name: "higgsfield:successor", holder: "successor-holder", expiresAt: future },
  ]);
  const [gone] = await insertReturning(db, schema.higgsfieldJobs, {
    ...owned,
    kind: "import",
    maxCredits: 0,
    pid: dead,
    startedAt: now,
    leaseName: "higgsfield:import",
    leaseHolder: "stopped-import-holder",
    externalJobIds: ["retained-import-id"],
  });
  const [fresh] = await insertReturning(db, schema.higgsfieldJobs, {
    ...owned,
    pid: process.pid,
    startedAt: now,
    heartbeatAt: now,
  });
  const [stale] = await insertReturning(db, schema.higgsfieldJobs, {
    ...owned,
    status: "queued",
    createdAt: staleAt,
  });
  const [foreign] = await insertReturning(db, schema.higgsfieldJobs, {
    ...owned,
    workerHost: workerIdentity.host === "foreign-worker" ? "other-worker" : "foreign-worker",
    pid: process.pid,
    externalJobIds: ["foreign-remote-id"],
  });
  const [legacy] = await insertReturning(db, schema.higgsfieldJobs, {
    ...owned,
    workerHost: null,
    workerInstance: null,
    pid: dead,
  });
  const [protectedJob] = await insertReturning(db, schema.higgsfieldJobs, {
    ...owned,
    leaseName: "higgsfield:protected",
    leaseHolder: "live-holder",
  });
  const [superseded] = await insertReturning(db, schema.higgsfieldJobs, {
    ...owned,
    leaseName: "higgsfield:successor",
    leaseHolder: "old-holder",
  });

  // Hosted page views leave even this PC's stale identified work untouched.
  process.env.APP_MODE = "online";
  assert.deepEqual(await reapJobs(now), []);
  assert.equal((await getJob(gone.id))?.status, "running");
  assert.equal((await getJob(stale.id))?.status, "queued");
  assert.equal(
    (await db.select().from(schema.leases).where(eq(schema.leases.name, "higgsfield:import")))[0]
      ?.holder,
    "stopped-import-holder",
  );
  process.env.APP_MODE = "pc";

  const reaped = await reapJobs(now);
  assert.deepEqual(
    reaped.sort((a, b) => a - b),
    [gone.id, stale.id, superseded.id].sort((a, b) => a - b),
  );
  const failed = await getJob(gone.id);
  assert.equal(failed?.status, "failed");
  assert.match(failed?.error ?? "", /owning worker stopped heartbeating/);
  assert.deepEqual(failed?.externalJobIds, ["retained-import-id"]);
  assert.equal((await getJob(stale.id))?.status, "failed");
  assert.equal((await getJob(superseded.id))?.status, "failed");
  for (const unchanged of [fresh, foreign, legacy, protectedJob])
    assert.equal((await getJob(unchanged.id))?.status, "running");
  assert.deepEqual((await getJob(foreign.id))?.externalJobIds, ["foreign-remote-id"]);
  assert.equal(pidAlive(process.pid), true);
  const [successor] = await db
    .select()
    .from(schema.leases)
    .where(eq(schema.leases.name, "higgsfield:successor"));
  assert.equal(successor?.holder, "successor-holder", "reaping cannot release a successor's lease");
  assert.equal(calls().length, 0, "reaping never invokes the provider CLI");

  // The expired lease is released by its holder, so a new import can start.
  assert.equal(
    (await db.select().from(schema.leases).where(eq(schema.leases.name, "higgsfield:import")))
      .length,
    0,
  );
  const job = await (await startJob({ kind: "import", maxCredits: 0 })).finished;
  assert.equal(job.status, "done");
});

test("a missing binary or an unplugged drive fails the run with a plain message", async () => {
  process.env.CLAUDE_CLI_PATH = path.join(base, "no-such-claude");
  const noBin = await (await startJob({ kind: "import", maxCredits: 0 })).finished;
  assert.equal(noBin.status, "failed");
  assert.match(noBin.error ?? "", /Could not start .*no-such-claude.*logged in/);

  process.env.CLAUDE_CLI_PATH = FAKE;
  process.env.MEDIA_ROOT = path.join(base, "unplugged");
  const noDrive = await (await startJob({ kind: "import", maxCredits: 0 })).finished;
  assert.equal(noDrive.status, "failed");
  assert.match(noDrive.error ?? "", /Media drive not connected/);
  assert.equal(calls().length, 0);
});

test("retry with retained remote IDs preserves the request in a zero-credit recovery row", async () => {
  const first = await (
    await startJob({ kind: "free", description: "a red bicycle in the rain", maxCredits: 4 })
  ).finished;
  assert.deepEqual(first.externalJobIds, ["abc12345"]);
  const originalArgument = extractArgument(first.prompt);
  assert.ok(originalArgument);

  // This existing fake mode reports no new HF_JOB or HF_FILE markers.
  process.env.FAKE_CLAUDE_MODE = "fail";
  const second = await (await retryJob(first.id, 100)).finished;
  assert.notEqual(second.id, first.id);
  assert.equal(second.kind, "free");
  assert.equal(second.status, "failed");
  assert.equal(second.maxCredits, 0, "known provider IDs override a requested positive ceiling");
  assert.equal(second.recoveryOfJobId, first.id);
  assert.deepEqual(second.externalJobIds, first.externalJobIds);
  assert.deepEqual(second.outputPaths, first.outputPaths);
  assert.equal(extractArgument(second.prompt), originalArgument);
  assert.ok(second.prompt.includes("a red bicycle in the rain"));
  assert.ok(second.prompt.includes(`job #${second.id}`));
  assert.ok(second.prompt.includes(`Source content-engine job: #${first.id}.`));
  assert.ok(second.prompt.includes('Known Higgsfield jobs: ["abc12345"].'));
  assert.ok(second.prompt.includes("Spend at most 0 credits"));
  assert.ok(
    second.prompt.includes("Never call a generation, submission, edit, or paid provider tool"),
  );

  const [initialCall, recoveryCall] = calls();
  assert.equal(calls().length, 2);
  assert.equal(initialCall.stdin, first.prompt);
  assert.equal(recoveryCall.stdin, second.prompt);
  const allowed = recoveryCall.args[recoveryCall.args.indexOf("--allowedTools") + 1];
  assert.deepEqual(
    allowed.split(",").filter((tool) => tool.startsWith("mcp__")),
    ["mcp__higgsfield__balance", "mcp__higgsfield__jobs_wait", "mcp__higgsfield__show_generations"],
  );
  const source = await getJob(first.id);
  assert.equal(source?.maxCredits, 4);
  assert.equal(source?.prompt, first.prompt);
  assert.deepEqual(source?.externalJobIds, first.externalJobIds);
});

test("actions and the status route are owner-only", async () => {
  const denied = await as(employee, () =>
    startHiggsfieldJobAction({ kind: "import", maxCredits: 0 }),
  );
  assert.deepEqual(denied, { ok: false, error: "Only the owner can start Higgsfield runs." });

  const bad = await as(owner, () =>
    startHiggsfieldJobAction({ kind: "free", description: "x", maxCredits: 5 }),
  );
  assert.equal(bad.ok, false);

  process.env.FAKE_CLAUDE_MODE = "hang";
  const ok = await as(owner, () => startHiggsfieldJobAction({ kind: "import", maxCredits: 0 }));
  assert.equal(ok.ok, true);
  const jobId = ok.ok ? ok.jobId : 0;

  const busy = await as(owner, () => startHiggsfieldJobAction({ kind: "import", maxCredits: 0 }));
  assert.equal(busy.ok, false);
  assert.match(busy.ok ? "" : busy.error, /already running/);

  const route = (cookie: string) =>
    callRoute(
      (req) => getJobRoute(req, { params: Promise.resolve({ id: String(jobId) }) }),
      new Request(`http://localhost/api/higgsfield/jobs/${jobId}`, { headers: { cookie } }),
    );
  assert.equal((await route(employee)).status, 403);
  const res = await route(owner);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; prompt?: string };
  assert.equal(body.status, "running");
  assert.equal(body.prompt, undefined);

  assert.equal((await as(employee, () => cancelHiggsfieldJobAction(jobId))).ok, false);
  const cancelled = await as(owner, () => cancelHiggsfieldJobAction(jobId));
  assert.deepEqual(cancelled, { ok: true, status: "cancelled" });
  await settleRuns();

  process.env.FAKE_CLAUDE_MODE = "done";
  const retried = await as(owner, () => retryHiggsfieldJobAction(jobId));
  assert.equal(retried.ok, true);
  const retriedId = retried.ok ? retried.jobId : 0;
  await settleRuns();
  assert.equal((await getJob(retriedId))?.status, "done");
});
