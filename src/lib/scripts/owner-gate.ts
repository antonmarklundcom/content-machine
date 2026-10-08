import "server-only";
import { NextResponse } from "next/server";

import { isOwner } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";

/**
 * The spend gate for the script routes (PLAN.md §1.20): the same 401/403
 * statuses and `{ error }` body as `/api/generate`. Null means go ahead.
 */
export async function ownerOnly(what: string): Promise<NextResponse | null> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isOwner(user)) {
    return NextResponse.json(
      { error: `${what} spends money, which is the owner's to spend.` },
      { status: 403 },
    );
  }
  return null;
}

/** A list of positive integer ids from a JSON body, or null if it is not one. */
export function idList(value: unknown): number[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const ids = value.map(Number);
  return ids.every((n) => Number.isInteger(n) && n > 0) ? ids : null;
}
