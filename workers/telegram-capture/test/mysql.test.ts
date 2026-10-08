import assert from "node:assert/strict";
import { test } from "node:test";

import type { Connection } from "mysql2/promise";
import { LEARN_DONE_SQL, SAVE_SQL } from "../src/handler";
import { queryOnConnection, WORKER_CONNECTION_FLAGS } from "../src/mysql";

test("Worker connections disable FOUND_ROWS so a duplicate cannot report newly saved", () => {
  assert.deepEqual(WORKER_CONNECTION_FLAGS, ["-FOUND_ROWS"]);
});

test("MySQL save result preserves new-versus-existing reply and exact URL identity", async () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  let affectedRows = 1;
  const connection = {
    async execute(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql === SAVE_SQL) return [{ insertId: 42, affectedRows }, []];
      if (sql === "SELECT id, url FROM clips WHERE id = ?") {
        return [[{ id: 42, url: "https://example.test/clip" }], []];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as unknown as Pick<Connection, "execute">;
  const query = queryOnConnection(connection);

  assert.deepEqual(await query(SAVE_SQL, ["https://example.test/clip", "other", null]), [
    { id: 42, created: true },
  ]);
  affectedRows = 0;
  assert.deepEqual(await query(SAVE_SQL, ["https://example.test/clip", "other", "note"]), [
    { id: 42, created: false },
  ]);
  assert.deepEqual(
    calls.map((call) => call.sql),
    [
      SAVE_SQL,
      "SELECT id, url FROM clips WHERE id = ?",
      SAVE_SQL,
      "SELECT id, url FROM clips WHERE id = ?",
    ],
  );
});

test("MySQL save refuses a duplicate URL hash that points to a different URL", async () => {
  const connection = {
    async execute(sql: string) {
      if (sql === SAVE_SQL) return [{ insertId: 42, affectedRows: 0 }, []];
      return [[{ id: 42, url: "https://different.test/clip" }], []];
    },
  } as unknown as Pick<Connection, "execute">;
  await assert.rejects(
    queryOnConnection(connection)(SAVE_SQL, ["https://example.test/clip"]),
    /URL hash collision/,
  );
});

test("MySQL command result reads the qualifying learn row after the update", async () => {
  const calls: string[] = [];
  const connection = {
    async execute(sql: string) {
      calls.push(sql);
      if (sql === LEARN_DONE_SQL) return [{ affectedRows: 1 }, []];
      if (sql === "SELECT id, title FROM clips WHERE id = ? AND purpose = 'learn'") {
        return [[{ id: 9, title: "A small step" }], []];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as unknown as Pick<Connection, "execute">;
  assert.deepEqual(await queryOnConnection(connection)(LEARN_DONE_SQL, [9]), [
    { id: 9, title: "A small step" },
  ]);
  assert.deepEqual(calls, [
    LEARN_DONE_SQL,
    "SELECT id, title FROM clips WHERE id = ? AND purpose = 'learn'",
  ]);
});
