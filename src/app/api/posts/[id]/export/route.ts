import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { exportBrief, exportPack } from "@/lib/posts/engine";
import { POST_EXPORT_FORMATS, type PostExportFormat } from "@/lib/posts/export";
import { postErrorResponse, routeId } from "@/lib/posts/http";

/**
 * GET /api/posts/[id]/export?format=brief|pack (PLAN.md §1.45, §1.49).
 *
 * - `brief` — every visual with its prompt, target file and the brand kit's
 *   Higgsfield references, for `/higgsfield-post`.
 * - `pack` — caption, first comment and the files in order, for the phone.
 *
 * Markdown by default (with the JSON in a fenced block for the brief);
 * `&as=json` returns the JSON alone. Signed-in only; free, so not owner-gated.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const id = routeId((await context.params).id);
  if (!id) return NextResponse.json({ error: "not a post id" }, { status: 400 });

  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "brief") as PostExportFormat;
  if (!POST_EXPORT_FORMATS.includes(format)) {
    return NextResponse.json(
      { error: `format must be one of ${POST_EXPORT_FORMATS.join(", ")}` },
      { status: 400 },
    );
  }

  let exported;
  try {
    exported = format === "brief" ? await exportBrief(id) : await exportPack(id);
  } catch (error) {
    return postErrorResponse(error);
  }
  if (url.searchParams.get("as") === "json") return NextResponse.json(exported.json);
  return new Response(exported.markdown, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}
