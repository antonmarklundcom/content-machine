import assert from "node:assert/strict";
import { test } from "node:test";

import { LEARN_DONE_SQL, SAVE_SQL } from "../src/handler";
import { queryOnConnection, WORKER_CONNECTION_FLAGS, type WorkerConnection } from "../src/mysql";

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
      if (sql === "SELECT id, url, note FROM clips WHERE id = ?") {
        return [[{ id: 42, url: "https://example.test/clip", note: "note" }], []];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as unknown as WorkerConnection;
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
      "SELECT id, url, note FROM clips WHERE id = ?",
      SAVE_SQL,
      "SELECT id, url, note FROM clips WHERE id = ?",
    ],
  );
});

test("MySQL save refuses a duplicate URL hash that points to a different URL", async () => {
  const connection = {
    async execute(sql: string) {
      if (sql === SAVE_SQL) return [{ insertId: 42, affectedRows: 0 }, []];
      return [[{ id: 42, url: "https://different.test/clip" }], []];
    },
  } as unknown as WorkerConnection;
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
  } as unknown as WorkerConnection;
  assert.deepEqual(await queryOnConnection(connection)(LEARN_DONE_SQL, [9]), [
    { id: 9, title: "A small step" },
  ]);
  assert.deepEqual(calls, [
    LEARN_DONE_SQL,
    "SELECT id, title FROM clips WHERE id = ? AND purpose = 'learn'",
  ]);
});

function duplicateFixture(options: { busy?: boolean; failWrite?: boolean } = {}) {
  const calls: string[] = [];
  let holder = "";
  const connection = {
    async beginTransaction() {
      calls.push("BEGIN");
    },
    async commit() {
      calls.push("COMMIT");
    },
    async rollback() {
      calls.push("ROLLBACK");
    },
    async execute(sql: string, params: unknown[] = []) {
      calls.push(sql);
      if (sql === SAVE_SQL) return [{ insertId: 42, affectedRows: 0 }, []];
      if (sql === "SELECT id, url, note FROM clips WHERE id = ?")
        return [[{ id: 42, url: "https://example.test/clip", note: "old" }], []];
      if (sql.startsWith("INSERT INTO leases")) {
        assert.equal(params[0], "learn:clip:42");
        assert.equal(params[2], 10 * 60 * 1000 * 1000);
        holder = String(params[1]);
        assert.match(holder, /^[a-f0-9-]{36}$/);
        return [{ affectedRows: 1 }, []];
      }
      if (sql.startsWith("SELECT holder FROM leases")) {
        assert.equal(params[1], holder);
        return [options.busy ? [] : [{ holder }], []];
      }
      if (sql === "SELECT id, url, note, purpose FROM clips WHERE id = ? FOR UPDATE")
        return [[{ id: 42, url: "https://example.test/clip", note: "old", purpose: "learn" }], []];
      if (sql.startsWith("UPDATE clips SET note")) {
        assert.match(
          sql,
          /summary = NULL, learn_category = NULL, how_to_start = NULL, learn_details = NULL, error = NULL/,
        );
        assert.deepEqual(params, ["new", 42]);
        if (options.failWrite) throw new Error("synthetic write failure");
        return [{ affectedRows: 1 }, []];
      }
      if (sql.startsWith("DELETE FROM leases")) {
        assert.deepEqual(params, ["learn:clip:42", holder]);
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as unknown as WorkerConnection;
  return { calls, query: queryOnConnection(connection) };
}

test("changed duplicate notes take the shared clip lease after the autocommit insert", async () => {
  const fixture = duplicateFixture();
  assert.deepEqual(await fixture.query(SAVE_SQL, ["https://example.test/clip", "other", "new"]), [
    { id: 42, created: false },
  ]);
  assert.equal(fixture.calls[0], SAVE_SQL);
  assert.equal(fixture.calls[1], "SELECT id, url, note FROM clips WHERE id = ?");
  assert.equal(fixture.calls[2], "BEGIN");
  assert.equal(fixture.calls.at(-1), "COMMIT");
  assert.equal(
    fixture.calls.some((sql) => sql.startsWith("DELETE FROM leases")),
    true,
  );
});

test("busy duplicate notes return retry information without updating context or deleting another lease", async () => {
  const fixture = duplicateFixture({ busy: true });
  assert.deepEqual(await fixture.query(SAVE_SQL, ["https://example.test/clip", "other", "new"]), [
    { id: 42, created: false, busy: true },
  ]);
  assert.equal(fixture.calls.at(-1), "ROLLBACK");
  assert.equal(
    fixture.calls.some(
      (sql) => sql.startsWith("UPDATE clips") || sql.startsWith("DELETE FROM leases"),
    ),
    false,
  );
});

test("duplicate note write failures roll back the claimed lease and context together", async () => {
  const fixture = duplicateFixture({ failWrite: true });
  await assert.rejects(
    fixture.query(SAVE_SQL, ["https://example.test/clip", "other", "new"]),
    /synthetic write failure/,
  );
  assert.equal(fixture.calls.at(-1), "ROLLBACK");
  assert.equal(fixture.calls.includes("COMMIT"), false);
});
