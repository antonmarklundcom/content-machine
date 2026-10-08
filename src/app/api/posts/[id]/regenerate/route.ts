import { NextResponse } from "next/server";

import { isPostSection, POST_SECTIONS } from "@/lib/posts/assemble";
import { regenerateSection } from "@/lib/posts/engine";
import { postErrorResponse, routeId } from "@/lib/posts/http";
import { ownerOnly } from "@/lib/scripts/owner-gate";

export const maxDuration = 120;

/**
 * POST /api/posts/[id]/regenerate — rewrite one section of a post's draft
 * and keep the rest (PLAN.md §5.O11.2). Body: `{ section }`, one of
 * `POST_SECTIONS`. Owner-only: it spends. Responds with `{ post, costUsd }`.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await ownerOnly("Rewriting a post");
  if (denied) return denied;

  const id = routeId((await context.params).id);
  if (!id) return NextResponse.json({ error: "not a post id" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  if (!isPostSection(body.section)) {
    return NextResponse.json(
      { error: `section must be one of ${POST_SECTIONS.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await regenerateSection(id, body.section));
  } catch (error) {
    return postErrorResponse(error);
  }
}
