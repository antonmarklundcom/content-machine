import { authorizeCronRequest } from "@/lib/cron-auth";
import { publishDue, summarizeDue } from "@/lib/publish";

/**
 * `GET|POST /api/cron/publish` — the online twin of `npm run publish:due`
 * (PLAN.md §5.O13), called every 5 minutes by Hostinger's cron:
 *
 *   curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" \
 *     https://<subdomain>/api/cron/publish
 *
 * Publishes `scheduled` posts whose time has come, under the `publish` lease;
 * a second overlapping call answers 409 without touching anything.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const auth = authorizeCronRequest(request.headers);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const limit = Number(new URL(request.url).searchParams.get("limit"));
  try {
    const report = await publishDue({
      limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
    });
    if (report.busy) return json({ ok: false, error: summarizeDue(report) }, 409);
    return json({ ok: true, summary: summarizeDue(report), ...report }, 200);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export const GET = handle;
export const POST = handle;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
