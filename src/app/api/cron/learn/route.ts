import { authorizeCronRequest } from "@/lib/cron-auth";
import { isAutomationAllowed } from "@/lib/automation/store";
import { processLearnClips } from "@/lib/learn/process";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  const auth = authorizeCronRequest(request.headers);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  try {
    if (!(await isAutomationAllowed("learningSummaries")))
      return Response.json({ ok: true, paused: true });
    const result = await processLearnClips({ limit: 5, automatic: true });
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
