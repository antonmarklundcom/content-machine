import assert from "node:assert/strict";
import { test } from "node:test";
import { LOGIN_WINDOW_MS, loginAttemptKey, nextLoginAttempt } from "./throttle-policy";
test("login throttle normalizes email without storing it in a key", () => {
  const key = loginAttemptKey(" Owner@Example.invalid ");
  assert.equal(key, loginAttemptKey("owner@example.invalid"));
  assert.equal(key.length, 64);
  assert.equal(key.includes("owner"), false);
});
test("login window increments and expires; malformed state cannot wedge login", () => {
  assert.deepEqual(nextLoginAttempt({ started: 1000, count: 7 }, 1001), {
    started: 1000,
    count: 8,
  });
  assert.deepEqual(nextLoginAttempt({ started: 1000, count: 8 }, 1000 + LOGIN_WINDOW_MS), {
    started: 1000 + LOGIN_WINDOW_MS,
    count: 1,
  });
  assert.deepEqual(nextLoginAttempt({ started: Infinity, count: -1 }, 2000), {
    started: 2000,
    count: 1,
  });
});
