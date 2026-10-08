import assert from "node:assert/strict";
import { test } from "node:test";
import { requireDisposableTestDatabase } from "./test-database-guard";

const local = "mysql://postgres:postgres@localhost:3306/content_engine_test";

test("requires explicit destructive test opt-in and dedicated test database name", () => {
  assert.throws(
    () => requireDisposableTestDatabase(local, undefined),
    /ALLOW_DESTRUCTIVE_TEST_DB=1/,
  );
  assert.throws(
    () => requireDisposableTestDatabase("mysql://u:p@localhost:3306/production", "1"),
    /dedicated \*_test database/,
  );
  assert.equal(requireDisposableTestDatabase(local, "1"), local);
});

test("rejects remote database hosts independently of forced mysql driver settings", () => {
  const remote = "mysql://u:p@db.example.com:3306/content_engine_test";
  const previousDriver = process.env.DB_DRIVER;
  process.env.DB_DRIVER = "mysql";
  try {
    assert.throws(() => requireDisposableTestDatabase(remote, "1"), /non-allowlisted host/);
    assert.equal(requireDisposableTestDatabase(remote, "1", "db.example.com"), remote);
  } finally {
    if (previousDriver === undefined) delete process.env.DB_DRIVER;
    else process.env.DB_DRIVER = previousDriver;
  }
});

test("rejects Neon and malformed URLs before a database pool can be opened", () => {
  assert.throws(
    () => requireDisposableTestDatabase("mysql://u:p@branch.neon.tech/app_test", "1"),
    /Neon database/,
  );
  assert.throws(
    () =>
      requireDisposableTestDatabase(
        "mysql://u:p@branch.neon.tech/app_test",
        "1",
        "branch.neon.tech",
      ),
    /Neon database/,
  );
  assert.throws(() => requireDisposableTestDatabase("not a url", "1"), /valid MySQL/);
});
