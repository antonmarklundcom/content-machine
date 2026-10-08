import { NextResponse } from "next/server";

import { getJob } from "@/lib/higgsfield/run";
import { ownerOnly } from "@/lib/media/serve";

/**
 * GET /api/higgsfield/jobs/<id> — one run's status, for the generate button's
 * polling (build 4 §3.H). Owner-only, like the runs themselves. The prompt is
 * left out (it is the whole brief); the log tail is included.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await ownerOnly();
  if (denied) return denied;
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id <= 0)
    return NextResponse.json({ error: "not a job id" }, { status: 400 });
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { prompt: _prompt, ...rest } = job;
  return NextResponse.json(rest, { headers: { "cache-control": "no-store" } });
}
