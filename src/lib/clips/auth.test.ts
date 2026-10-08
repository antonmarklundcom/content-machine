/**
 * The capture route is the app's only credential a phone holds, so the two
 * things worth pinning are that a missing deployment secret never falls open,
 * and that a missing header is not treated as a valid one.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizeClipToken, CLIP_TOKEN_ENV, presentedClipToken } from "./auth";

function headers(init: Record<string, string> = {}): Headers {
  return new Headers(init);
}

function withToken<T>(value: string | undefined, fn: () => T): T {
  const before = process.env[CLIP_TOKEN_ENV];
  if (value === undefined) delete process.env[CLIP_TOKEN_ENV];
  else process.env[CLIP_TOKEN_ENV] = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env[CLIP_TOKEN_ENV];
    else process.env[CLIP_TOKEN_ENV] = before;
  }
}

test("the Bearer token is read case-insensitively, and only from Bearer", () => {
  assert.equal(presentedClipToken(headers({ authorization: "Bearer abc" })), "abc");
  assert.equal(presentedClipToken(headers({ authorization: "bearer abc" })), "abc");
  assert.equal(presentedClipToken(headers({ authorization: "Basic abc" })), null);
  assert.equal(presentedClipToken(headers({ authorization: "Bearer   " })), null);
  assert.equal(presentedClipToken(headers()), null);
});

test("an unset CLIP_TOKEN disables the path rather than accepting anything", () => {
  withToken(undefined, () => {
    const result = authorizeClipToken(headers({ authorization: "Bearer anything" }));
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.status, 503);
  });
});

test("a wrong or missing token is 401, a correct one is accepted", () => {
  withToken("s3cret-value", () => {
    assert.equal(authorizeClipToken(headers({ authorization: "Bearer s3cret-value" })).ok, true);
    assert.equal(authorizeClipToken(headers({ authorization: "Bearer nope" })).ok, false);
    // No header at all must not pass the constant-time comparison against "".
    assert.equal(authorizeClipToken(headers()).ok, false);
  });
});

test("an empty string is never a valid token, even against an empty env value", () => {
  // An empty CLIP_TOKEN is an unset one — it must disable the path, not match
  // a request that presents nothing.
  withToken("", () => {
    assert.equal(authorizeClipToken(headers()).ok, false);
    assert.equal(authorizeClipToken(headers({ authorization: "Bearer " })).ok, false);
  });
});
