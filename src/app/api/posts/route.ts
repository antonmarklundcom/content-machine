import { NextResponse } from "next/server";

import { createPostFromIdea } from "@/lib/posts/engine";
import { postErrorResponse } from "@/lib/posts/http";
import { ownerOnly } from "@/lib/scripts/owner-gate";

export const maxDuration = 300; // a topic-first post researches before it writes

/**
 * POST /api/posts — draft a post for one account and save it as `drafting`
 * (PLAN.md §5.O11.3). Body: `{ accountId, ideaId? | topic?, format?, title? }`
 * — exactly one of `ideaId` and `topic`. Owner-only: it spends. Responds 201
 * with `{ post, costUsd }`.
 */
export async function POST(request: Request) {
  const denied = await ownerOnly("Writing a post");
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const accountId = Number(body.accountId);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }
  const ideaId = body.ideaId === undefined || body.ideaId === null ? null : Number(body.ideaId);
  if (ideaId !== null && (!Number.isInteger(ideaId) || ideaId <= 0)) {
    return NextResponse.json({ error: "ideaId must be an idea id" }, { status: 400 });
  }
  for (const field of ["topic", "format", "title"] as const) {
    if (body[field] !== undefined && body[field] !== null && typeof body[field] !== "string") {
      return NextResponse.json({ error: `${field} must be text` }, { status: 400 });
    }
  }

  try {
    const { post, costUsd } = await createPostFromIdea({
      accountId,
      ideaId,
      topic: body.topic,
      format: body.format,
      title: body.title,
    });
    return NextResponse.json({ post, costUsd }, { status: 201 });
  } catch (error) {
    return postErrorResponse(error);
  }
}
