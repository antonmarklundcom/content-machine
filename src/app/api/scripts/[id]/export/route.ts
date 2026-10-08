import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { getScript } from "@/lib/bridge/scripts";
import { validateScriptBody, type ScriptBodyV1 } from "@/lib/scripts/contract";
import {
  EXPORT_FORMATS,
  shotList,
  shotListMarkdown,
  slugify,
  teleprompterMarkdown,
  thumbnailList,
  thumbnailListMarkdown,
  type ExportFormat,
} from "@/lib/scripts/export";

/**
 * GET /api/scripts/[id]/export?format=md|json|shots|thumbnails (PLAN.md §5.O8.4, §1.34).
 *
 * - `md` — teleprompter Markdown.
 * - `json` — the stored body, as is.
 * - `shots` — the Higgsfield shot list as Markdown with the same list as a
 *   fenced JSON block; `&as=json` returns just the JSON.
 * - `thumbnails` — the three thumbnail concepts as numbered 16:9 prompts with
 *   their text overlay and target files (build 2b, idea 10), for
 *   `/higgsfield-thumbnails`; same Markdown + JSON shape, same `&as=json`.
 *
 * Signed-in only; free, so not owner-gated. `&download=1` adds a
 * Content-Disposition with a file name.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "not a script id" }, { status: 400 });

  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "md") as ExportFormat;
  if (!EXPORT_FORMATS.includes(format)) {
    return NextResponse.json(
      { error: `format must be one of ${EXPORT_FORMATS.join(", ")}` },
      { status: 400 },
    );
  }

  const row = await getScript(id);
  if (!row) return NextResponse.json({ error: `no script ${id}` }, { status: 404 });

  const verdict = validateScriptBody(row.body);
  if (!verdict.ok) {
    // Only possible if a later contract version is stored and this code is older.
    return NextResponse.json(
      { error: "stored body does not match contract v1", errors: verdict.errors },
      { status: 500 },
    );
  }
  const script = {
    id: row.id,
    brandId: row.brandId,
    status: row.status,
    body: row.body as ScriptBodyV1,
  };

  const name = `script-${row.id}-${slugify(row.title)}`;
  const disposition = (file: string): Record<string, string> =>
    url.searchParams.get("download")
      ? { "content-disposition": `attachment; filename="${file}"` }
      : {};

  if (format === "json") {
    return NextResponse.json(script.body, { headers: disposition(`${name}.json`) });
  }
  if (format === "shots") {
    const list = shotList(script);
    if (url.searchParams.get("as") === "json") {
      return NextResponse.json(list, { headers: disposition(`${name}-shots.json`) });
    }
    return new NextResponse(shotListMarkdown(list), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        ...disposition(`${name}-shots.md`),
      },
    });
  }
  if (format === "thumbnails") {
    const list = thumbnailList(script);
    if (url.searchParams.get("as") === "json") {
      return NextResponse.json(list, { headers: disposition(`${name}-thumbnails.json`) });
    }
    return new NextResponse(thumbnailListMarkdown(list), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        ...disposition(`${name}-thumbnails.md`),
      },
    });
  }
  return new NextResponse(teleprompterMarkdown(script), {
    headers: { "content-type": "text/markdown; charset=utf-8", ...disposition(`${name}.md`) },
  });
}
