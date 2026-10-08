import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { syncMeta } from "@/lib/meta/sync";

export const dynamic = "force-dynamic";

/** "Sync now" (§5.O12): the same work as `npm run meta:sync`, owner only. */
export async function POST(): Promise<NextResponse> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner only." }, { status: 403 });
  const report = await syncMeta();
  return NextResponse.json(report);
}
