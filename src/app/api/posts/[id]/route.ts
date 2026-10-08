import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { updatePost, type PostPatch } from "@/lib/posts/engine";
import { postErrorResponse, routeId } from "@/lib/posts/http";
import { isPostStatus } from "@/lib/posts/status";

const TEXT_FIELDS = ["caption", "firstComment", "notes", "permalink"] as const;

/**
 * PATCH /api/posts/[id] — edit a post (PLAN.md §5.O11.3). Any of `title`,
 * `body` (a whole `PostDraft`, validated), `caption`, `firstComment`,
 * `notes`, `permalink`, `scheduledFor` (ISO date or null) and `status` (legal
 * moves only, applied last). Free, so any signed-in user; responds with
 * `{ post }`, 400 with `errors` for a body that fails the contract, 409 for an
 * illegal status move.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const id = routeId((await context.params).id);
  if (!id) return NextResponse.json({ error: "not a post id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "send a JSON object" }, { status: 400 });
  }

  if ((body.status === "scheduled" || body.scheduledFor !== undefined) && user.role !== "owner")
    return NextResponse.json({ error: "Only the owner can schedule a post." }, { status: 403 });
  if (
    body.expectedRevision !== undefined &&
    (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0)
  )
    return NextResponse.json(
      { error: "expectedRevision must be a non-negative integer" },
      { status: 400 },
    );
  const patch: PostPatch = {};
  if (body.title !== undefined) {
    if (typeof body.title !== "string")
      return NextResponse.json({ error: "title must be text" }, { status: 400 });
    patch.title = body.title;
  }
  for (const field of TEXT_FIELDS) {
    if (body[field] === undefined) continue;
    if (body[field] !== null && typeof body[field] !== "string") {
      return NextResponse.json({ error: `${field} must be text or null` }, { status: 400 });
    }
    patch[field] = body[field] === null || body[field].trim() === "" ? null : body[field];
  }
  if (patch.permalink) {
    try {
      const { protocol } = new URL(patch.permalink);
      if (protocol !== "https:" && protocol !== "http:") throw new Error();
    } catch {
      return NextResponse.json({ error: "permalink must be an http(s) URL" }, { status: 400 });
    }
  }
  if (body.scheduledFor !== undefined) {
    if (body.scheduledFor === null) patch.scheduledFor = null;
    else {
      const date = typeof body.scheduledFor === "string" ? new Date(body.scheduledFor) : null;
      if (!date || Number.isNaN(date.getTime())) {
        return NextResponse.json(
          { error: "scheduledFor must be an ISO date or null" },
          { status: 400 },
        );
      }
      patch.scheduledFor = date;
    }
  }
  if (body.status !== undefined) {
    if (!isPostStatus(body.status))
      return NextResponse.json({ error: "not a post status" }, { status: 400 });
    patch.status = body.status;
  }
  if (body.body !== undefined) patch.body = body.body;

  try {
    const post = await updatePost(id, patch, {
      expectedRevision: body.expectedRevision,
      ...(user.role === "owner" && (body.status === "scheduled" || body.scheduledFor !== undefined)
        ? { authorizeSend: { ownerId: user.id } }
        : {}),
    });
    return NextResponse.json({ post: { ...post, publishUpload: undefined } });
  } catch (error) {
    return postErrorResponse(error);
  }
}
