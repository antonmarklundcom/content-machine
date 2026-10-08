import "server-only";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

import { isOwner } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { authoringMediaDenied } from "@/lib/media/permissions";
import { mediaRoot, mediaRootMessage, mediaRootStatus, resolveMediaFile, splitRelative } from "@/lib/storage/root";

/**
 * Serving a library file to the owner (PLAN.md §5.O10.5) — the same rules as
 * build 2's `/api/media/[...path]`: owner-only, only files that resolve inside
 * the media root, and an answer that says nothing about what exists elsewhere.
 * An unplugged drive is a 503 with `code: "missing"`, never a 500.
 */

/** 401/403 for anyone but the owner, else null. */
export async function ownerOnly(): Promise<NextResponse | null> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isOwner(user)) return NextResponse.json({ error: "Media files are the owner's." }, { status: 403 });
  return null;
}

/** Media previews/downloads support the authenticated authoring team. */
export async function authoringOnly(): Promise<NextResponse | null> {
  const user = await getSession();
  return authoringMediaDenied(user);
}

export function notFound(): NextResponse {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

/** One `bytes=a-b` range, or null for none / one we do not serve (then the whole file goes out). */
function parseRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, a, b] = match;
  if (!a && !b) return null;
  let start: number;
  let end: number;
  if (!a) {
    start = Math.max(0, size - Number(b));
    end = size - 1;
  } else {
    start = Number(a);
    end = b ? Math.min(Number(b), size - 1) : size - 1;
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

/** Stream `rel` (relative to `MEDIA_ROOT`) as `mime`, with single-range support so videos can seek. */
export async function serveMediaFile(request: Request, rel: string | null, mime: string): Promise<NextResponse> {
  const root = mediaRoot();
  const status = await mediaRootStatus(root);
  if (status === "missing") {
    return NextResponse.json({ error: mediaRootMessage(status), code: "missing" }, { status: 503 });
  }
  const segments = rel ? splitRelative(rel) : null;
  const file = segments ? await resolveMediaFile(segments, root) : null;
  if (!file) return notFound();

  const { size } = await stat(file);
  const headers: Record<string, string> = {
    "content-type": mime,
    "accept-ranges": "bytes",
    "cache-control": "private, no-cache",
    "x-content-type-options": "nosniff",
  };
  const range = parseRange(request.headers.get("range"), size);
  if (range === "invalid") {
    return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body =
    size === 0
      ? null
      : (Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>);
  headers["content-length"] = String(size === 0 ? 0 : end - start + 1);
  if (range) headers["content-range"] = `bytes ${start}-${end}/${size}`;
  return new NextResponse(body, { status: range ? 206 : 200, headers });
}
