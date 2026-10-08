import { insertReturning } from "@/db/mutations";
import { AsyncLocalStorage } from "node:async_hooks";

import { db, schema } from "@/db";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/token";

/**
 * Driving App Router route handlers from a test process (PLAN.md §5.O5.2).
 *
 * §5.O5.2 asks for the routes themselves, not the functions behind them, and
 * that distinction is the point: the status codes, the auth checks and the
 * request parsing are the contract, and every one of them lives in the handler
 * rather than in the library it calls. `POST(new Request(...))` is almost enough
 * on its own — the one thing missing is that `cookies()` and `headers()` read
 * from Next's async-local storage, which only a running server normally fills.
 *
 * So this fills it. Two internal modules are imported for it
 * (`work-async-storage`, `work-unit-async-storage`); they are internal, and the
 * risk is that a Next upgrade moves them. That risk is bounded and loud — the
 * import fails, every route test fails at once, and the fix is one file — which
 * is a better trade than the alternatives: booting a real Next server per test
 * (slow, and its own source of flakes) or testing the libraries and leaving the
 * handlers as the untested half, which is what build 1 already did.
 */

type Internals = {
  workAsyncStorage: { run<T>(store: unknown, fn: () => T): T };
  workUnitAsyncStorage: { run<T>(store: unknown, fn: () => T): T };
  RequestCookies: new (headers: Headers) => unknown;
};

let internals: Promise<Internals> | undefined;

/**
 * Loaded lazily, and behind the `AsyncLocalStorage` global.
 *
 * Next's storage modules throw "AsyncLocalStorage accessed in runtime where it
 * is not available" at import time unless the class is on `globalThis` — the
 * edge runtime puts it there, plain Node does not. Static imports are hoisted
 * above any assignment in this file, so the import has to be dynamic for the
 * assignment to land first.
 */
async function nextInternals(): Promise<Internals> {
  internals ??= (async () => {
    (globalThis as Record<string, unknown>).AsyncLocalStorage ??= AsyncLocalStorage;
    const [work, workUnit, cookies] = await Promise.all([
      import("next/dist/server/app-render/work-async-storage.external.js"),
      import("next/dist/server/app-render/work-unit-async-storage.external.js"),
      import("next/dist/server/web/spec-extension/cookies.js"),
    ]);
    return {
      workAsyncStorage: work.workAsyncStorage as Internals["workAsyncStorage"],
      workUnitAsyncStorage: workUnit.workUnitAsyncStorage as Internals["workUnitAsyncStorage"],
      RequestCookies: cookies.RequestCookies as Internals["RequestCookies"],
    };
  })();
  return internals;
}

type Handler = (request: Request) => Promise<Response>;

/**
 * Run a route handler with `request` in scope, and hand back its response.
 *
 * The two stores are the minimum a handler's `cookies()`/`headers()` touch. The
 * mutable jars are wired to the request's own cookies rather than to an empty
 * set: a route handler runs in Next's "action" phase, where `cookies()` returns
 * the *mutable* jar, so leaving them empty would make every request look signed
 * out no matter what header it carried — which is a test that passes for the
 * wrong reason.
 */
export async function callRoute(handler: Handler, request: Request): Promise<Response> {
  const { workAsyncStorage, workUnitAsyncStorage, RequestCookies } = await nextInternals();
  const url = new URL(request.url);

  const workStore = {
    route: url.pathname,
    page: url.pathname,
    phase: "action",
    forceStatic: false,
    dynamicShouldError: false,
    isStaticGeneration: false,
    fallbackRouteParams: null,
  };

  const requestStore = {
    type: "request",
    phase: "action",
    implicitTags: { tags: [], expirationsByCacheKind: new Map() },
    headers: request.headers,
    cookies: new RequestCookies(request.headers),
    mutableCookies: new RequestCookies(request.headers),
    userspaceMutableCookies: new RequestCookies(request.headers),
    url: { pathname: url.pathname, search: url.search },
    rootParams: {},
    draftMode: undefined,
  };

  return workAsyncStorage.run(workStore, () =>
    workUnitAsyncStorage.run(requestStore, () => handler(request)),
  );
}

/** A JSON POST, the shape every route under test takes. */
export function jsonPost(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/**
 * Insert a user and return the `Cookie` header a signed-in request carries.
 *
 * A real signed token rather than a stubbed `getSession`: the token format and
 * the secret check are part of what "the route is authenticated" means, and a
 * stub would pass with either of them broken.
 */
export async function signIn(
  role: "owner" | "employee",
  email = `${role}@example.com`,
): Promise<{ userId: number; cookie: string }> {
  const [user] = await insertReturning(
    db,
    schema.users,
    { email, passwordHash: "not-a-real-hash", role },
    { id: schema.users.id },
  );

  const token = await createSessionToken(user.id, requireSessionSecret());
  return { userId: user.id, cookie: `${SESSION_COOKIE}=${token}` };
}

function requireSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set (32+ chars) before signing a test session in.");
  }
  return secret;
}
