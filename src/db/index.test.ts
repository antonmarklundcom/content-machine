import assert from "node:assert/strict";
import { test } from "node:test";
import { db, closeDb } from "./index";
test("database import and shutdown are lazy; use without configuration fails before connecting", async () => {
  const before = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    await closeDb();
    assert.throws(() => db.select(), /DATABASE_URL is not set/);
  } finally {
    await closeDb();
    if (before !== undefined) process.env.DATABASE_URL = before;
  }
});
