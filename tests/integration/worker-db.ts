import type { Pool } from "mysql2/promise";

import { queryOnConnection } from "../../workers/telegram-capture/src/mysql";
import type { Query } from "../../workers/telegram-capture/src/handler";

/** Adapt one Worker query to an isolated mysql2 pool, keeping DML/readback on one connection. */
export function workerQueryFromPool(pool: Pool): Query {
  return async (text, params) => {
    const connection = await pool.getConnection();
    try {
      await connection.query("SET SESSION time_zone = '+00:00'");
      return await queryOnConnection(connection)(text, params);
    } finally {
      connection.release();
    }
  };
}
