import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getRender } from "@/lib/video/queries";
import { renderView } from "@/lib/video/view";

/**
 * GET /api/video/renders/<id> — one render's status for the poller
 * (`RenderButton`, the /video page): status, duration, error and links to the
 * MP4/SRT/VTT through `/api/media/asset/<id>`. Signed-in only.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { id } = await context.params;
  if (!/^\d{1,9}$/.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const row = await getRender(Number(id));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(renderView(row), { headers: { "cache-control": "no-store" } });
}
