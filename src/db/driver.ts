import type { PoolOptions } from "mysql2/promise";

export type DbDriver = "mysql";
/** Accept only the protocol used by mysql2. No silent PostgreSQL transport fallback. */
export function resolveDriver(url: string | undefined, override = process.env.DB_DRIVER): DbDriver {
  if (override?.trim() && override.trim().toLowerCase() !== "mysql")
    throw new Error('DB_DRIVER must be "mysql".');
  databaseOptions(url);
  return "mysql";
}

export function databaseOptions(url: string | undefined): PoolOptions {
  if (!url) throw new Error("DATABASE_URL is not set — see .env.example.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL must be a valid mysql:// connection URL.");
  }
  if (parsed.protocol !== "mysql:" || !parsed.hostname || !parsed.pathname.slice(1))
    throw new Error("DATABASE_URL must use mysql://user:password@host:3306/database.");
  const limit = Number(process.env.DB_POOL_LIMIT ?? 5);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new Error("DB_POOL_LIMIT must be an integer from 1 to 20.");
  const sslMode = parsed.searchParams.get("ssl");
  if (sslMode && !["true", "false"].includes(sslMode))
    throw new Error("DATABASE_URL ssl must be true or false.");
  const unknown = [...parsed.searchParams.keys()].filter((k) => k !== "ssl");
  if (unknown.length) throw new Error("Unsupported DATABASE_URL option: " + unknown.join(", "));
  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ""),
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)),
    charset: "utf8mb4_bin",
    timezone: "Z",
    connectionLimit: limit,
    waitForConnections: true,
    queueLimit: 100,
    connectTimeout: 10000,
    enableKeepAlive: true,
    flags: ["FOUND_ROWS"],
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: false,
    // JSON is selected through Drizzle's decoder. Raw callers explicitly decode their own JSON.
    dateStrings: ["DATE", "DATETIME", "TIMESTAMP"],
    ...(sslMode === "true" ? { ssl: { rejectUnauthorized: true } } : {}),
  };
}
