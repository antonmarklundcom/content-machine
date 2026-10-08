import { NextResponse } from "next/server";

import { adaptToFamily } from "@/lib/posts/engine";
import { postErrorResponse, routeId } from "@/lib/posts/http";
import { ownerOnly } from "@/lib/scripts/owner-gate";

export const maxDuration = 300; // one model call per sibling account

/**
 * POST /api/posts/[id]/adapt — "Adapt to family" (PLAN.md §1.47): one sibling
 * post per other active account in the family on the same platform. Owner-
 * only: it spends. Re-runnable; accounts that already have a version are
 * skipped. Responds 201 with `{ created, skipped, costUsd }` (200 when nothing
 * new was created).
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await ownerOnly("Adapting a post");
  if (denied) return denied;

  const id = routeId((await context.params).id);
  if (!id) return NextResponse.json({ error: "not a post id" }, { status: 400 });

  try {
    const result = await adaptToFamily(id);
    return NextResponse.json(result, { status: result.created.length ? 201 : 200 });
  } catch (error) {
    return postErrorResponse(error);
  }
}
