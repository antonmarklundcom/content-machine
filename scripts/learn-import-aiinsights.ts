/**
 * Import old aiinsights items into MariaDB learn clips, idempotently by URL.
 *
 *   npm run learn:import-aiinsights -- --json aiinsights-items.json --dry-run
 *   npm run learn:import-aiinsights -- --json aiinsights-items.json
 *   AIINSIGHTS_DATABASE_URL='postgres://...' npm run learn:import-aiinsights
 *
 * JSON is an array of raw items rows. Direct legacy PostgreSQL reads require
 * the optional CLI/dev dependency pg; it is dynamically imported only here.
 * The old database is read in a READ ONLY transaction, never migrated.
 */
import { readFile } from "node:fs/promises";
import { closeDb } from "../src/db";
import { importAiinsights, readAiinsightsItems, type AiinsightsRow } from "../src/lib/learn/import";

type LegacyClient = {
  query(text: string): Promise<{ rows: AiinsightsRow[] }>;
  release(): void;
};
type LegacyPool = { connect(): Promise<LegacyClient>; end(): Promise<void> };
type LegacyPg = { Pool: new (options: { connectionString: string; max: number }) => LegacyPool };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function sourceRows(): Promise<AiinsightsRow[]> {
  const file = arg("--json");
  if (process.argv.includes("--json") && (!file || file.startsWith("--"))) {
    throw new Error("--json requires the path to an exported JSON items array.");
  }
  if (file) {
    const rows: unknown = JSON.parse(await readFile(file, "utf8"));
    if (
      !Array.isArray(rows) ||
      rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))
    ) {
      throw new Error("The JSON import must be an array of raw aiinsights item objects.");
    }
    return rows as AiinsightsRow[];
  }
  const url = process.env.AIINSIGHTS_DATABASE_URL?.trim();
  if (!url)
    throw new Error(
      "Pass --json <export.json> or set AIINSIGHTS_DATABASE_URL for the read-only legacy source.",
    );
  const protocol = new URL(url).protocol;
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    throw new Error(
      "AIINSIGHTS_DATABASE_URL is the legacy source and must use postgres:// or postgresql://. DATABASE_URL remains mysql://.",
    );
  }
  const moduleName = "pg";
  let legacy: LegacyPg;
  try {
    legacy = (await import(moduleName)) as LegacyPg;
  } catch {
    throw new Error(
      "The optional pg CLI dependency is unavailable. Install development dependencies or use --json <export.json>.",
    );
  }
  const pool = new legacy.Pool({ connectionString: url, max: 1 });
  let client: LegacyClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    const connected = client;
    const rows = await readAiinsightsItems(
      async (text) => (await connected.query(text)).rows,
      arg("--table") ?? "items",
    );
    await client.query("COMMIT");
    return rows;
  } catch (err) {
    await client?.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client?.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const report = await importAiinsights(await sourceRows(), { dryRun });
  console.log(
    `${report.read} aiinsights item(s): ${report.inserted} ${dryRun ? "would be imported" : "imported"}, ${report.existing} already present, ${report.unusable} unusable.`,
  );
}

main()
  .then(async () => {
    await closeDb();
    process.exitCode = 0;
  })
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb().catch(() => {});
    process.exitCode = 1;
  });
