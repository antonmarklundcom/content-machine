import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { createPool, type PoolConnection, type RowDataPacket } from "mysql2/promise";

import { closeDb } from "@/db";
import { databaseOptions } from "@/db/driver";
import { requireDisposableTestDatabase } from "@/db/test-database-guard";
import { resetFakeGemini } from "@/lib/ai-fake";

/**
 * Run native integration tests against an explicitly disposable MariaDB
 * database. `tests/integration/preload.mjs` validates the hostname, `_test`
 * suffix, and destructive opt-in before any application pool can be created.
 */
let prepared: Promise<void> | undefined;

/** Bring the active MariaDB migration folder up to date once per process. */
export function prepareDatabase(): Promise<void> {
  // Validate on every call, including when migration work is already cached.
  const url = requireDisposableTestDatabase(
    process.env.DATABASE_URL,
    process.env.ALLOW_DESTRUCTIVE_TEST_DB,
  );
  prepared ??= (async () => {
    const pool = createPool(databaseOptions(url));
    try {
      await migrate(drizzle(pool), { migrationsFolder: "./drizzle-mysql" });
    } finally {
      await pool.end();
    }
  })();
  return prepared;
}

/**
 * Clear application rows without disabling strict SQL mode or suppressing
 * foreign-key/duplicate errors. Migration bookkeeping is retained so each
 * reset does not replay DDL. Foreign-key checks are restored even if a table
 * truncate fails.
 */
export async function resetTables(): Promise<void> {
  // Never rely on preload: callers may import this helper directly or change env.
  const url = requireDisposableTestDatabase(
    process.env.DATABASE_URL,
    process.env.ALLOW_DESTRUCTIVE_TEST_DB,
  );
  resetFakeGemini();
  await prepareDatabase();

  const pool = createPool(databaseOptions(url));
  let connection: PoolConnection | undefined;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT TABLE_NAME FROM information_schema.tables
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_NAME <> '__drizzle_migrations'`,
    );
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const row of rows) {
        const name = String(row.TABLE_NAME).replaceAll("`", "``");
        await connection.query(`TRUNCATE TABLE \`${name}\``);
      }
    } finally {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    }
    // Explicit synthetic enabled fixture for legacy workflow tests. Production
    // defaults remain disabled; automation tests override/delete this row.
    await connection.query(
      "INSERT INTO application_settings (`key`, `value`, `updated_at`) VALUES (?, ?, current_timestamp(3))",
      [
        "automation",
        JSON.stringify({
          enabled: true,
          youtubeMonitoring: true,
          captureAnalysis: true,
          learningSummaries: true,
          publishing: true,
        }),
      ],
    );
  } finally {
    connection?.release();
    await pool.end();
  }
}

/** Close the application pool so the test process exits cleanly. */
export async function teardown(): Promise<void> {
  await closeDb();
}

/** Fixed instants, so nothing here depends on which month the suite runs in. */
export const JAN = new Date("2026-01-15T12:00:00.000Z");
export const FEB = new Date("2026-02-15T12:00:00.000Z");
