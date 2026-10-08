import assert from "node:assert/strict";
import { test } from "node:test";
import { createSessionToken, SESSION_TTL_MS, timingSafeEqual, verifySessionToken } from "./token";

const SECRET = "test-secret-value-long-enough";

test("a freshly signed token verifies and carries its user", async () => {
  const now = 1_700_000_000_000;
  const token = await createSessionToken(42, SECRET, now);
  const payload = await verifySessionToken(token, SECRET, now);
  assert.deepEqual(payload, { userId: 42, expiresAt: now + SESSION_TTL_MS });
});

test("an expired token is rejected", async () => {
  const now = 1_700_000_000_000;
  const token = await createSessionToken(1, SECRET, now);
  assert.equal(await verifySessionToken(token, SECRET, now + SESSION_TTL_MS + 1), null);
});

test("tampering with the user id invalidates the signature", async () => {
  const now = 1_700_000_000_000;
  const token = await createSessionToken(1, SECRET, now);
  const [, expiry, signature] = token.split(".");
  assert.equal(await verifySessionToken(`999.${expiry}.${signature}`, SECRET, now), null);
});

test("extending the expiry invalidates the signature", async () => {
  const now = 1_700_000_000_000;
  const token = await createSessionToken(1, SECRET, now);
  const [userId, expiry, signature] = token.split(".");
  const later = String(Number(expiry) + 60_000);
  assert.equal(await verifySessionToken(`${userId}.${later}.${signature}`, SECRET, now), null);
});

test("a token signed with another secret is rejected", async () => {
  const now = 1_700_000_000_000;
  const token = await createSessionToken(1, "other-secret", now);
  assert.equal(await verifySessionToken(token, SECRET, now), null);
});

test("malformed input is rejected rather than throwing", async () => {
  for (const junk of [undefined, "", "a.b", "a.b.c.d", "....", "not-a-token"]) {
    assert.equal(await verifySessionToken(junk, SECRET), null);
  }
});

test("timingSafeEqual agrees with === on equality", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
});
