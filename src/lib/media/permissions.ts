import { NextResponse } from "next/server";
import type { User } from "@/db/schema";
import { canAccessAuthoringMedia } from "@/lib/auth/roles";

/** The shared permission response for read-only authoring media routes. */
export function authoringMediaDenied(user: User | null): NextResponse | null {
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!canAccessAuthoringMedia(user)) return NextResponse.json({ error: "not allowed" }, { status: 403 });
  return null;
}
