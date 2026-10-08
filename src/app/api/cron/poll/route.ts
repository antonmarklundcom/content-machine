import { authorizeCronRequest } from "@/lib/cron-auth";
import { POLL_LEASE, POLL_LEASE_TTL_MS, withLease } from "@/lib/lease";
import { pollSources, type PollResult } from "@/lib/poll";
import { SpendCapExceededError } from "@/lib/spend";

/**
 * `GET|POST /api/cron/poll` — the endpoint Hostinger's cron calls hourly.
 *
 *   curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" \
 *     https://<subdomain>/api/cron/poll
 *
 * It calls `pollSources()` directly rather than spawning
 * `scripts/poll-sources.ts`: the logic is shared library code, and shelling out
 * from the web process would cost a second Node runtime on a shared Hostinger
 * slot and reduce every failure to an exit code.
 *
 * The response is JSON either way — a cron wrapper reads the status code, a
 * human reads the body when something looks wrong.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 10;

/**
 * Hourly cron plus a poll that can outlive an hour is a recipe for two runs
 * ingesting the same source at once. Ingest upserts are idempotent so nothing
 * corrupts, but the second run wastes YouTube quota and can double-submit a
 * batch, so it is refused outright. The guard is the `poll` lease in the
 * database (PLAN.md §1.19), not a module variable: `npm run yt:poll` takes the
 * same lease, and a module variable only ever saw its own process.
 */

async function handle(request: Request): Promise<Response> {
  const auth = authorizeCronRequest(request.headers);
  if (!auth.ok) {
    return json({ ok: false, error: auth.error }, auth.status);
  }

  const url = new URL(request.url);
  const limit = positiveInt(url.searchParams.get("limit")) ?? DEFAULT_LIMIT;
  const analyze = url.searchParams.get("analyze") !== "false";
  // `?captions=false` on the online deploy: new uploads only, captions are
  // fetched by the PC's poll (YouTube blocks datacenter IPs; O14).
  const captions = url.searchParams.get("captions") !== "false";
  const dryRun = url.searchParams.get("dry-run") === "true";

  const startedAt = Date.now();
  try {
    const run = await withLease(POLL_LEASE, POLL_LEASE_TTL_MS, () =>
      pollSources({ limit, analyze, captions, dryRun }),
    );
    if (!run.acquired) {
      return json(
        { ok: false, error: "A poll is already running; skipping this invocation." },
        409,
      );
    }
    const result = run.value;
    return json({ ok: true, ...summarize(result), result }, 200);
  } catch (err) {
    if (err instanceof SpendCapExceededError) {
      // Working as designed, not a crash — 402 so a cron wrapper can tell the
      // difference without parsing the body.
      return json({ ok: false, error: err.message, reason: "spend-cap" }, 402);
    }
    return json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      },
      500,
    );
  }
}

export const GET = handle;
export const POST = handle;

/** One line a human can read from a cron log without opening the JSON. */
function summarize(result: PollResult): { summary: string } {
  const videos = result.sources.reduce((n, s) => n + s.videos, 0);
  const failed = result.sources.filter((s) => s.error).length;
  const parts = [
    `${result.sources.length} source(s)`,
    `${videos} video(s)`,
    `${result.pendingAnalysis} pending`,
  ];
  if (failed > 0) parts.push(`${failed} source error(s)`);
  if (result.reapedClips > 0) parts.push(`${result.reapedClips} stuck clip(s) failed`);
  if (result.quotaExhausted) parts.push("youtube quota exhausted");
  for (const c of result.collected) {
    parts.push(
      `collected ${c.batchId} (${c.outcome.succeeded} ok, ${c.outcome.failed} failed` +
        (c.outcome.alreadyWritten > 0 ? `, ${c.outcome.alreadyWritten} already written` : "") +
        ")",
    );
  }
  for (const a of result.abandoned) {
    parts.push(`abandoned ${a.batchId} (unreadable, billed ${a.estimatedUsd.toFixed(4)})`);
  }
  parts.push(
    result.submitted
      ? `submitted ${result.submitted.batchId} (${result.submitted.videoCount} video(s))`
      : `no batch submitted: ${result.skipped?.reason ?? "unknown"}`,
  );
  return { summary: parts.join(" · ") };
}

function positiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
