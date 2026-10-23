import "dotenv/config";
import { createConnection } from "mysql2/promise";
import { checkPersistentMedia } from "./lib/persistent-media.mjs";
const problems = [];
const env = process.env;
if (process.argv.includes("--media") || process.argv.includes("--media-write")) {
  try {
    await checkPersistentMedia(env.MEDIA_ROOT, process.cwd(), {
      writeProbe: process.argv.includes("--media-write"),
    });
    console.log(
      "Persistent media directory preflight passes. Existing media was not read; repeat after redeployment and verify independent backups separately.",
    );
  } catch (error) {
    problems.push(error.message);
  }
} else {
  console.log(
    "Persistent media is unverified. Before using media, run deployment:check with --media (or --media-write for a synthetic write/read/delete probe).",
  );
}
if (env.APP_MODE !== "online") problems.push("Set APP_MODE=online.");
try {
  const url = new URL(env.APP_URL);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error();
} catch {
  problems.push(
    "Set APP_URL to the canonical HTTPS origin, for example https://content.antonmarklund.com.",
  );
}
if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
  problems.push("Set a random SESSION_SECRET of at least 32 characters.");
if (!/^[a-f0-9]{64}$/i.test(env.ENCRYPTION_KEY ?? ""))
  problems.push("Set ENCRYPTION_KEY to 64 random hex characters.");
if (!env.DATABASE_URL?.startsWith("mysql://"))
  problems.push("Set the intended MariaDB DATABASE_URL.");
if ([env.GEMINI_FAKE, env.VOICE_FAKE].includes("1"))
  problems.push("Remove test provider flags from hosted settings.");
if (env.AI_PROVIDER && env.AI_PROVIDER !== "gemini")
  problems.push("Hosted AI_PROVIDER must be gemini; PC CLI sessions are unavailable.");
if (!env.GEMINI_API_KEY)
  console.log("Optional: GEMINI_API_KEY is missing; AI generation cannot run yet.");
if (!env.YOUTUBE_API_KEY)
  console.log("Optional: YOUTUBE_API_KEY is missing; YouTube metadata ingestion cannot run yet.");
if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exitCode = 1;
} else
  console.log(
    "Private deployment configuration passes. No secrets displayed; no provider calls made.",
  );
if (!problems.length && process.argv.includes("--database")) {
  let connection;
  try {
    const url = new URL(env.DATABASE_URL);
    connection = await createConnection({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
      connectTimeout: 10000,
      ...(url.searchParams.get("ssl") === "true" ? { ssl: { rejectUnauthorized: true } } : {}),
    });
    await connection.query("SELECT 1");
    await connection.query("SELECT learn_details FROM clips LIMIT 0");
    await connection.query("SELECT `key`, value FROM application_settings LIMIT 0");
    const [rows] = await connection.query(
      "SELECT COUNT(*) AS owners FROM yt_users WHERE role='owner'",
    );
    if (!rows[0].owners) throw new Error();
    console.log("Database connection, pilot schema and owner account verified (read-only).");
  } catch {
    console.error(
      "Database verification failed. Check connectivity, explicit migrations and owner setup privately.",
    );
    process.exitCode = 1;
  } finally {
    await connection?.end();
  }
}
