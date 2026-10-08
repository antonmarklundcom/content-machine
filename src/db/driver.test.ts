import assert from "node:assert/strict";
import { test } from "node:test";
import { databaseOptions, resolveDriver } from "./driver";
const LOCAL = "mysql://test:synthetic@127.0.0.1:3306/content_machine_test";
test("MariaDB and MySQL share the native MySQL driver", () => {
  assert.equal(resolveDriver(LOCAL, "mysql"), "mysql");
  assert.equal(resolveDriver(LOCAL, "  "), "mysql");
  assert.equal(databaseOptions(LOCAL).database, "content_machine_test");
});
test("driver refuses PostgreSQL, unsupported URL options and wrong overrides", () => {
  assert.throws(() => resolveDriver("postgres://u:p@localhost/db"), /mysql/);
  assert.throws(() => resolveDriver(LOCAL, "pg"), /DB_DRIVER/);
  assert.throws(() => resolveDriver(LOCAL + "?sslmode=require"), /Unsupported/);
  assert.throws(() => resolveDriver(undefined), /not set/);
  assert.throws(() => resolveDriver("not-url"), /valid mysql/);
});
test("pool is bounded, UTC, strict identity charset, encoded credentials and verified TLS", () => {
  const opts = databaseOptions("mysql://u:p%40%23%2F@localhost/db?ssl=true");
  assert.equal(opts.password, "p@#/");
  assert.equal(opts.timezone, "Z");
  assert.equal(opts.charset, "utf8mb4_bin");
  assert.equal(opts.connectionLimit, 5);
  assert.deepEqual(opts.ssl, { rejectUnauthorized: true });
  const before = process.env.DB_POOL_LIMIT;
  try {
    process.env.DB_POOL_LIMIT = "0";
    assert.throws(() => databaseOptions(LOCAL), /DB_POOL_LIMIT/);
  } finally {
    if (before === undefined) delete process.env.DB_POOL_LIMIT;
    else process.env.DB_POOL_LIMIT = before;
  }
});
