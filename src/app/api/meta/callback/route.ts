import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { META_STATE_COOKIE, metaConfig, redirectUri, requestOrigin } from "@/lib/meta/config";
import { GraphClient, redact } from "@/lib/meta/graph";
import { saveMetaConnection } from "@/lib/meta/integration";
import { autoLinkByHandle } from "@/lib/meta/link";
import { exchangeCode } from "@/lib/meta/oauth";
import { listMetaTargets } from "@/lib/meta/pages";

export const dynamic = "force-dynamic";

function back(request: Request, params: Record<string, string>): NextResponse {
  const url = new URL("/settings", requestOrigin(request));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.hash = "meta";
  const res = NextResponse.redirect(url);
  res.cookies.delete({ name: META_STATE_COOKIE, path: "/api/meta" });
  return res;
}

/**
 * Where Meta sends the browser back (§5.O12): check the state, trade the code
 * for a long-lived token, store it encrypted, and link IG accounts whose
 * handle matches. The token never appears in a redirect, a log or an error.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const user = await getSession();
  if (user?.role !== "owner")
    return back(request, { meta_error: "Only the owner can connect Meta." });

  const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (denied) return back(request, { meta_error: `Meta said: ${denied}`.slice(0, 300) });

  const state = url.searchParams.get("state");
  const expected = (await cookies()).get(META_STATE_COOKIE)?.value;
  if (!state || !expected || state !== expected) {
    return back(request, {
      meta_error: "The login link expired or was opened in another browser. Try Connect again.",
    });
  }
  const code = url.searchParams.get("code");
  if (!code) return back(request, { meta_error: "Meta sent no code. Try Connect again." });
  const config = metaConfig();
  if (!config) return back(request, { meta_error: "The App ID and App Secret are not set." });

  try {
    const conn = await exchangeCode(config, code, redirectUri(requestOrigin(request)));
    const row = await saveMetaConnection(conn);
    let linked = 0;
    try {
      linked = await autoLinkByHandle(await listMetaTargets(new GraphClient(conn.token)), row.id);
    } catch {
      // Linking is also offered by hand in step 6; a failure here is not a failed connect.
    }
    return back(request, { meta: "connected", linked: String(linked) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return back(request, { meta_error: redact(msg).slice(0, 300) });
  }
}
