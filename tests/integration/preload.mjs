import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import "dotenv/config";
import { requireDisposableTestDatabase } from "../../src/db/test-database-guard.ts";

// This import runs before test modules load, including eager imports of `src/db`.
// Validate the disposable endpoint and explicit destructive opt-in before any
// mysql2 application or migration pool can be constructed.
process.env.DATABASE_URL = requireDisposableTestDatabase(
  process.env.DATABASE_URL,
  process.env.ALLOW_DESTRUCTIVE_TEST_DB,
);

// Never let a developer's .env turn verification into paid/external work.
// Provider fakes are forced even if an existing .env explicitly disables them.
process.env.GEMINI_FAKE = "1";
process.env.VOICE_FAKE = "1";
process.env.AI_PROVIDER = "gemini";

/**
 * Next's request-scope modules expect AsyncLocalStorage on globalThis when
 * route modules are imported in plain Node test processes.
 */
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

/**
 * Stub next/navigation for the same process. Route handlers are expected to
 * return Responses; redirects and other page navigation fail loudly in this
 * test harness instead of being mistaken for successful route assertions.
 */
const require = createRequire(import.meta.url);
const navigationId = require.resolve("next/navigation");

function unsupported(name) {
  return (...args) => {
    throw new Error(
      `${name}(${args.map(String).join(", ")}) was called in a test process. ` +
        "Route handlers under test are expected to return a Response; only pages and " +
        "server actions navigate. See tests/integration/preload.mjs.",
    );
  };
}

require.cache[navigationId] = {
  id: navigationId,
  filename: navigationId,
  path: navigationId,
  loaded: true,
  children: [],
  paths: [],
  exports: {
    redirect: unsupported("redirect"),
    permanentRedirect: unsupported("permanentRedirect"),
    notFound: unsupported("notFound"),
    forbidden: unsupported("forbidden"),
    unauthorized: unsupported("unauthorized"),
    RedirectType: { push: "push", replace: "replace" },
  },
};
