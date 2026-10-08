import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { encryptionKeyProblem } from "@/lib/crypto";
import { META_STATE_COOKIE, metaConfig, redirectUri, requestOrigin } from "@/lib/meta/config";
import { loginDialogUrl } from "@/lib/meta/oauth";

export const dynamic = "force-dynamic";

function back(request: Request, error: string): NextResponse {
  const url = new URL("/settings", requestOrigin(request));
  url.searchParams.set("meta_error", error);
  url.hash = "meta";
  return NextResponse.redirect(url);
}

/** Settings → "Connect with Facebook": off to Meta's login dialog (§5.O12). */
export async function GET(request: Request): Promise<NextResponse> {
  const user = await getSession();
  if (user?.role !== "owner") return back(request, "Only the owner can connect Meta.");
  const config = metaConfig();
  if (!config) return back(request, "Save the App ID and App Secret first (step 4).");
  const keyProblem = encryptionKeyProblem();
  if (keyProblem) return back(request, keyProblem);

  const origin = requestOrigin(request);
  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(loginDialogUrl(config, redirectUri(origin), state));
  res.cookies.set(META_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/api/meta",
    maxAge: 600,
  });
  return res;
}
