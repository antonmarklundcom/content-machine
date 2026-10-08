import { NextResponse } from "next/server";
import { authorizeClipToken, presentedClipToken } from "@/lib/clips/auth";
import { isClipPurpose, normalizeTags, processYouTubeClip, saveClip } from "@/lib/clips/save";
import { parseCaptureMessage } from "@/lib/clips/telegram";
import { getSession } from "@/lib/auth/session";
import { getBrand, listBrands } from "@/lib/bridge";
import type { ClipPurpose, ClipSource } from "@/db/schema";

/**
 * `POST /api/clips` — the capture endpoint (PLAN.md §5.O2.1).
 *
 * Body: `{ "url": "...", "note": "why I saved this" }`. The note is optional
 * and is the guaranteed floor of a clip's usefulness (§1.7) — everything else
 * on the row is best-effort.
 *
 * [S16] Optional capture fields: `brandId`, `purpose`, `tags` (array or a
 * comma/space string) and `source` (`share` from the share page). The note may
 * also carry the Telegram grammar (`#guide #factcheck #visa`, §1.43) — the
 * hashtags are lifted out of it, and explicit fields win over them. A Bearer
 * call is a Shortcut, so its source is `shortcut`.
 *
 * This route is excluded from the session middleware (see src/middleware.ts)
 * because a share sheet has no cookie: middleware would answer a Shortcut with
 * a 307 to the login page, which the Shortcut would report as success. It
 * authenticates itself instead — cookie OR Bearer — and never falls open.
 */

// Ingest fetches metadata and captions; a long video's captions are not fast.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // Bearer first: it is the path with no cookie, and checking it first means a
  // Shortcut never depends on cookie parsing succeeding.
  const presentedToken = presentedClipToken(request.headers);
  if (presentedToken !== null) {
    const auth = authorizeClipToken(request.headers);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  } else if (!(await getSession())) {
    return NextResponse.json(
      { error: "Sign in, or send Authorization: Bearer <CLIP_TOKEN>." },
      { status: 401 },
    );
  }

  let body: {
    url?: unknown;
    note?: unknown;
    brandId?: unknown;
    purpose?: unknown;
    tags?: unknown;
    source?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const url = String(body.url ?? "").trim();
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
  let note = body.note === undefined || body.note === null ? null : String(body.note);

  let brandId: string | null = null;
  let purpose: ClipPurpose | null = null;
  let tags: string[] = [];
  if (note?.includes("#")) {
    const aliases = Object.fromEntries((await listBrands()).map((b) => [b.id, b.id]));
    const parsed = parseCaptureMessage(note, aliases);
    ({ brandId, purpose, tags } = parsed);
    note = parsed.note;
  }

  const explicitBrand = typeof body.brandId === "string" ? body.brandId.trim() : "";
  if (explicitBrand) {
    if (!(await getBrand(explicitBrand))) {
      return NextResponse.json({ error: `Unknown brand "${explicitBrand}".` }, { status: 400 });
    }
    brandId = explicitBrand;
  }
  if (body.purpose !== undefined && body.purpose !== null && body.purpose !== "") {
    if (!isClipPurpose(body.purpose)) {
      return NextResponse.json({ error: "Unknown purpose." }, { status: 400 });
    }
    purpose = body.purpose;
  }
  if (Array.isArray(body.tags) || typeof body.tags === "string") {
    tags = normalizeTags([...tags, ...normalizeTags(body.tags as string[] | string)]);
  }
  const source: ClipSource =
    presentedToken !== null ? "shortcut" : body.source === "share" ? "share" : "web";

  const saved = await saveClip({ url, note, brandId, purpose, tags, source });
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 });

  // The row exists from here on. Anything below can fail without losing the
  // capture, which is the whole point of writing it first (§1.6).
  let clip = saved.clip;
  if (clip.platform === "youtube" && clip.status !== "analyzed" && clip.status !== "promoted") {
    clip = await processYouTubeClip(clip);
  }

  return NextResponse.json({ clip, created: saved.created }, { status: saved.created ? 201 : 200 });
}
