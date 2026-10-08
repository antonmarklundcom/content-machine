import assert from "node:assert/strict";
import test from "node:test";
import { authorizeCronRequest, presentedSecret, secretsMatch } from "./cron-auth";

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

test("secretsMatch is true only for identical secrets", () => {
  assert.equal(secretsMatch("s3cret", "s3cret"), true);
  assert.equal(secretsMatch("s3cret", "s3crey"), false);
  // Different lengths must return false, not throw — timingSafeEqual rejects
  // unequal buffers, which is why both sides are hashed first.
  assert.equal(secretsMatch("s", "s3cret"), false);
  assert.equal(secretsMatch("", "s3cret"), false);
  assert.equal(secretsMatch("s3cret-with-a-much-longer-tail", "s3cret"), false);
});

test("presentedSecret reads either header form", () => {
  assert.equal(presentedSecret(headers({ "x-cron-secret": "abc" })), "abc");
  assert.equal(presentedSecret(headers({ authorization: "Bearer abc" })), "abc");
  assert.equal(presentedSecret(headers({ authorization: "bearer abc" })), "abc");
  assert.equal(presentedSecret(headers({ authorization: "Basic abc" })), null);
  assert.equal(presentedSecret(headers({})), null);
  // The dedicated header wins when both are present.
  assert.equal(
    presentedSecret(headers({ "x-cron-secret": "abc", authorization: "Bearer xyz" })),
    "abc",
  );
});

test("authorizeCronRequest accepts the configured secret", (t) => {
  t.after(() => delete process.env.CRON_SECRET);
  process.env.CRON_SECRET = "correct-horse";

  assert.deepEqual(authorizeCronRequest(headers({ "x-cron-secret": "correct-horse" })), {
    ok: true,
  });
  assert.deepEqual(authorizeCronRequest(headers({ authorization: "Bearer correct-horse" })), {
    ok: true,
  });
});

test("authorizeCronRequest rejects a wrong or missing secret with 401", (t) => {
  t.after(() => delete process.env.CRON_SECRET);
  process.env.CRON_SECRET = "correct-horse";

  for (const h of [
    headers({}),
    headers({ "x-cron-secret": "" }),
    headers({ "x-cron-secret": "wrong" }),
    headers({ "x-cron-secret": "correct-hors" }),
    headers({ authorization: "Bearer wrong" }),
  ]) {
    const result = authorizeCronRequest(h);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.status, 401);
  }
});

test("authorizeCronRequest fails closed when CRON_SECRET is unset", (t) => {
  t.after(() => delete process.env.CRON_SECRET);
  delete process.env.CRON_SECRET;

  const result = authorizeCronRequest(headers({ "x-cron-secret": "anything" }));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 503);
});

test("an empty CRON_SECRET disables the endpoint rather than accepting an empty header", (t) => {
  t.after(() => delete process.env.CRON_SECRET);
  process.env.CRON_SECRET = "";

  const result = authorizeCronRequest(headers({ "x-cron-secret": "" }));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 503);
});
