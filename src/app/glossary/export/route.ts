import { NextResponse } from "next/server";

import { isOwner } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { glossaryToCsv } from "@/lib/glossary/csv";
import { listGlossary, toCsvRow } from "@/lib/glossary/store";

export const dynamic = "force-dynamic";

/** GET /glossary/export — the whole glossary as UTF-8 CSV (owner only). */
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isOwner(user))
    return NextResponse.json({ error: "The glossary is the owner's." }, { status: 403 });
  const csv = glossaryToCsv((await listGlossary()).map(toCsvRow));
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="glossary.csv"',
    },
  });
}
