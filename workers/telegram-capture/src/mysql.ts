import type { ExecuteValues } from "mysql2";
import type { Connection, QueryResult, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type { Query } from "./handler";
import { LEARN_COMMIT_SQL, LEARN_DONE_SQL, SAVE_SQL } from "./handler";

/** Worker upsert replies require changed-row counts; the app CAS pool keeps FOUND_ROWS. */
export const WORKER_CONNECTION_FLAGS = ["-FOUND_ROWS"];

/** Convert mysql2's row/packet result protocol into the Worker handler's row protocol. */
export function queryOnConnection(connection: Pick<Connection, "execute">): Query {
  return async (text, params) => {
    const values = params as ExecuteValues[];
    if (text === SAVE_SQL) {
      const [result] = await connection.execute<ResultSetHeader>(text, values);
      if (!result.insertId)
        throw new Error("MariaDB clip upsert did not return an inserted or existing id.");
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT id, url FROM clips WHERE id = ?",
        [result.insertId],
      );
      const row = rows[0];
      if (!row || row.url !== values[0]) {
        throw new Error(
          "MariaDB clip URL hash collision; refusing to treat another URL as a duplicate.",
        );
      }
      return [{ id: Number(row.id), created: result.affectedRows === 1 }];
    }

    if (text === LEARN_DONE_SQL || text === LEARN_COMMIT_SQL) {
      await connection.execute(text, values);
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT id, title FROM clips WHERE id = ? AND purpose = 'learn'",
        [values[0]],
      );
      return rows.map((row) => ({ id: Number(row.id), title: row.title }));
    }

    const [result] = await connection.execute<QueryResult>(text, values);
    return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
  };
}
