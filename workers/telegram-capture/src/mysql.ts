import type { ExecuteValues } from "mysql2";
import type { Connection, QueryResult, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { clipWorkLease, CLIP_WORK_LEASE_TTL_MS } from "../../../src/lib/clips/work";

import type { Query } from "./handler";
import { LEARN_COMMIT_SQL, LEARN_DONE_SQL, SAVE_SQL } from "./handler";

/** Worker upsert replies require changed-row counts; the app CAS pool keeps FOUND_ROWS. */
export const WORKER_CONNECTION_FLAGS = ["-FOUND_ROWS"];
export type WorkerConnection = Pick<
  Connection,
  "execute" | "beginTransaction" | "commit" | "rollback"
>;

const CLAIM_CLIP_LEASE = `INSERT INTO leases (name, holder, expires_at)
VALUES (?, ?, timestampadd(microsecond, ?, current_timestamp(3)))
ON DUPLICATE KEY UPDATE
holder = if(expires_at < current_timestamp(3), values(holder), holder),
expires_at = if(expires_at < current_timestamp(3), values(expires_at), expires_at)`;

/** The insert's autocommit is over before taking this lease: no INSERT lock upgrade. */
async function updateDuplicateNote(
  connection: WorkerConnection,
  id: number,
  url: string,
  note: string,
): Promise<boolean> {
  const name = clipWorkLease(id);
  const holder = randomUUID();
  await connection.beginTransaction();
  try {
    await connection.execute(CLAIM_CLIP_LEASE, [name, holder, CLIP_WORK_LEASE_TTL_MS * 1000]);
    const [held] = await connection.execute<RowDataPacket[]>(
      "SELECT holder FROM leases WHERE name = ? AND holder = ? AND expires_at > current_timestamp(3) FOR UPDATE",
      [name, holder],
    );
    if (!held.length) {
      await connection.rollback();
      return false;
    }
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT id, url, note, purpose FROM clips WHERE id = ? FOR UPDATE",
      [id],
    );
    const clip = rows[0];
    if (!clip || clip.url !== url)
      throw new Error(
        "The saved clip changed before its note could be updated. Retry the capture.",
      );
    if (clip.note !== note) {
      await connection.execute(
        clip.purpose === "learn"
          ? "UPDATE clips SET note = ?, summary = NULL, learn_category = NULL, how_to_start = NULL, learn_details = NULL, error = NULL WHERE id = ?"
          : "UPDATE clips SET note = ? WHERE id = ?",
        [note, id],
      );
    }
    await connection.execute("DELETE FROM leases WHERE name = ? AND holder = ?", [name, holder]);
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  }
}

/** Convert mysql2's row/packet result protocol into the Worker handler's row protocol. */
export function queryOnConnection(connection: WorkerConnection): Query {
  return async (text, params) => {
    const values = params as ExecuteValues[];
    if (text === SAVE_SQL) {
      const [result] = await connection.execute<ResultSetHeader>(text, values);
      if (!result.insertId)
        throw new Error("MariaDB clip upsert did not return an inserted or existing id.");
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT id, url, note FROM clips WHERE id = ?",
        [result.insertId],
      );
      const row = rows[0];
      if (!row || row.url !== values[0]) {
        throw new Error(
          "MariaDB clip URL hash collision; refusing to treat another URL as a duplicate.",
        );
      }
      const created = result.affectedRows === 1;
      const note = values[2];
      if (!created && typeof note === "string" && note !== row.note) {
        const updated = await updateDuplicateNote(
          connection,
          Number(row.id),
          String(row.url),
          note,
        );
        if (!updated) return [{ id: Number(row.id), created: false, busy: true }];
      }
      return [{ id: Number(row.id), created }];
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
