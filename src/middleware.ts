import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/token";

/**
 * The gate (PLAN.md §9 PR-23), extended to the whole merged app.
 *
 * This is a single-owner (+ maybe employees) tool covering both the brand
 * content-ideation pages and the ported YouTube research tool, so the login
 * gates everything rather than only the /youtube/* section — there is no
 * separate account system for the brand side to fall back to.
 *
 * Signature-only: middleware runs on every request, and a database round trip
 * here would put Postgres in the path of static assets. A valid signature
 * proves the token was minted by this app and has not expired — pages that
 * need the *user* still call getSession(), which re-reads the row.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.SESSION_SECRET;
  // A missing secret must fail closed. Failing open would silently unlock the
  // whole app the first time someone forgets an env var on a redeploy.
  if (!secret || secret.length < 32) {
    return NextResponse.redirect(new URL("/youtube/login", request.url));
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token, secret)) return NextResponse.next();

  const url = new URL("/youtube/login", request.url);
  return NextResponse.redirect(url);
}

export const config = {
  /**
   * Everything except:
   *   /youtube/login  — the way back in
   *   /api/cron/*     — the hourly poll cron authenticates with its own
   *                     shared secret header (PR-14); it has no cookie and
   *                     never will
   *   /api/clips      — the capture endpoint (PLAN.md §5.O2.1). A phone share
   *                     sheet or iOS Shortcut sends a Bearer token and no
   *                     cookie; redirecting it to the login page would look
   *                     like a 200 to the Shortcut and silently lose the clip.
   *                     The route authenticates itself — cookie OR token.
   *   /_next, favicon — static assets, which never carry a session
   */
  matcher: ["/((?!youtube/login|api/cron|api/clips|_next/static|_next/image|favicon.ico).*)"],
};
