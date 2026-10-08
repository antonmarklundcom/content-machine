/** Safety checks for destructive integration tests. Kept pure for no-network tests. */
export function requireDisposableTestDatabase(
  url: string | undefined,
  optIn: string | undefined,
  allowlistedHosts: string | undefined = process.env.TEST_DATABASE_HOSTS,
): string {
  if (optIn !== "1") {
    throw new Error("Refusing destructive integration tests without ALLOW_DESTRUCTIVE_TEST_DB=1.");
  }
  if (!url)
    throw new Error("DATABASE_URL is not set. Configure a dedicated disposable *_test database.");

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL must be a valid MySQL connection URL.");
  }
  if (parsed.protocol !== "mysql:") {
    throw new Error("DATABASE_URL must use mysql://.");
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "neon.tech" || host.endsWith(".neon.tech")) {
    throw new Error("Refusing destructive integration tests against a Neon database.");
  }
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const allowed = new Set(
    (allowlistedHosts ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!loopback && !allowed.has(host)) {
    throw new Error(
      `Refusing destructive integration tests against non-allowlisted host "${host}".`,
    );
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/^[a-z0-9_]+_test$/i.test(database)) {
    throw new Error(
      "Refusing destructive integration tests: database name must be a dedicated *_test database.",
    );
  }
  return url;
}
