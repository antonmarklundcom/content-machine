/**
 * Read-only MariaDB connectivity/schema check. Loads .env through dotenv;
 * already-exported environment variables take precedence.
 *
 *   DATABASE_URL='mysql://user:pass@host:3306/dbname' npm run db:check
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { closeDb, db } from "../src/db";
import { queryRows } from "../src/db/mutations";

async function main(): Promise<void> {
  const target = redact(process.env.DATABASE_URL ?? "");
  console.log(`Connecting to ${target || "(DATABASE_URL not set)"}`);
  const started = Date.now();
  const [row] = await queryRows<{ version: string; db: string; now: string }>(
    db,
    sql`select version() as version, database() as db, now() as now`,
  );
  console.log(`Connected in ${Date.now() - started}ms`);
  console.log(`  MariaDB   ${row?.version ?? "?"}`);
  console.log(`  Database  ${row?.db ?? "?"}`);
  console.log(`  Server now ${row?.now ?? "?"}`);
  const tables = await queryRows<{ table_name: string }>(
    db,
    sql`select table_name from information_schema.tables where table_schema = database() order by table_name`,
  );
  const names = tables.map((table) => table.table_name);
  console.log(
    names.length
      ? `  Tables    ${names.length}: ${names.join(", ")}`
      : "  Tables    none yet — run `npm run db:migrate`.",
  );
}

function redact(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return url ? "(invalid DATABASE_URL)" : "";
  }
}

main()
  .then(async () => {
    await closeDb();
    console.log("\nOK");
    process.exitCode = 0;
  })
  .catch(async (err: unknown) => {
    console.error("\nDatabase check FAILED");
    console.error(err instanceof Error ? err.message : err);
    console.error(
      "\nCheck DATABASE_URL in .env or the exported environment, the Hostinger database/user permissions, hostname, port and TLS settings.",
    );
    await closeDb().catch(() => {});
    process.exitCode = 1;
  });
