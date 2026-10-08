import { getSession } from "@/lib/auth/session";
import { exportLessonsMarkdown } from "@/lib/bridge/lessons";
import { lessonsQueryFrom } from "../query";

/**
 * "Export Markdown" (PLAN.md §1.31): the current filter as a `.md` download,
 * grouped by kind, each lesson linked to its video at the timestamp.
 */
export async function GET(request: Request): Promise<Response> {
  if (!(await getSession())) return new Response("Sign in first.", { status: 401 });
  const params = new URL(request.url).searchParams;
  const query = lessonsQueryFrom({
    brand: params.get("brand") ?? undefined,
    kind: params.get("kind") ?? undefined,
    q: params.get("q") ?? undefined,
  });
  const markdown = await exportLessonsMarkdown(query);
  const name = `lessons${query.brandId ? `-${query.brandId.replace(/[^a-z0-9-]/gi, "")}` : ""}${query.kind ? `-${query.kind}` : ""}.md`;
  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
