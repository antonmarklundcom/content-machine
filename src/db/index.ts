import "dotenv/config";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { createPool, type Pool } from "mysql2/promise";
import { databaseOptions } from "./driver";
import * as schema from "./schema";

export type Db = MySql2Database<typeof schema>;
let pool: Pool | undefined;
let cached: Db | undefined;
function createDb(): Db {
  pool = createPool(databaseOptions(process.env.DATABASE_URL));
  // Session time drives leases, spend holds and scheduled work. Set before queued queries.
  pool.pool.on("connection", (connection) => {
    connection.query(
      "SET SESSION time_zone = '+00:00', SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",
      (err) => {
        if (err) connection.destroy();
      },
    );
  });
  return drizzle(pool, { schema, mode: "default" });
}
// Builds import routes without opening connections or requiring production secrets.
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    cached ??= createDb();
    if (prop === "transaction") {
      const transaction: Db["transaction"] = (fn, config) =>
        cached!.transaction(fn, { isolationLevel: "read committed", ...config });
      return transaction;
    }
    const value = Reflect.get(cached, prop);
    return typeof value === "function" ? value.bind(cached) : value;
  },
});
export { schema };
export async function closeDb(): Promise<void> {
  const active = pool;
  pool = undefined;
  cached = undefined;
  if (active) await active.end();
}
