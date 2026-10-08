import assert from "node:assert/strict";
import { test } from "node:test";

import { POST_STATUSES } from "@/db/schema";

import { checkTransition, POST_TRANSITIONS } from "./status";

const withBody = { hasBody: true, scheduledFor: null };

test("every status has a row, and every target is a status", () => {
  for (const status of POST_STATUSES) {
    assert.ok(POST_TRANSITIONS[status], status);
    for (const to of POST_TRANSITIONS[status]) assert.ok(POST_STATUSES.includes(to));
  }
});

test("the manual path: drafting → ready → published, and staying put is fine", () => {
  assert.deepEqual(checkTransition("drafting", "ready", withBody), { ok: true });
  assert.deepEqual(checkTransition("ready", "published", withBody), { ok: true });
  assert.deepEqual(checkTransition("published", "published", withBody), { ok: true });
});

test("illegal moves, a missing body and a missing date are refused with a reason", () => {
  const skip = checkTransition("drafting", "published", withBody);
  assert.equal(skip.ok, false);
  assert.match((skip as { error: string }).error, /can become idea, ready, archived/);
  assert.equal(checkTransition("published", "drafting", withBody).ok, false);
  assert.equal(checkTransition("publishing", "archived", withBody).ok, false);
  assert.equal(checkTransition("idea", "drafting", { hasBody: true, scheduledFor: null }).ok, true);
  assert.equal(checkTransition("archived", "drafting", withBody).ok, true);
  assert.equal(
    checkTransition("drafting", "ready", { hasBody: false, scheduledFor: null }).ok,
    false,
  );
  assert.equal(checkTransition("ready", "scheduled", withBody).ok, false);
  assert.equal(
    checkTransition("ready", "scheduled", { hasBody: true, scheduledFor: new Date() }).ok,
    true,
  );
});
