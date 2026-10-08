/**
 * The boundary PR-24 encodes is spend, not CRUD. `isOwner` is the pure half of
 * that decision and is what every UI branch calls, so its behaviour on a
 * missing user matters as much as on a present one.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { User } from "@/db/schema";
import { canAccessAuthoringMedia, ForbiddenError, isOwner } from "./roles";

function user(role: User["role"]): User {
  return {
    id: 1,
    email: "someone@example.com",
    role,
    passwordHash: null,
    createdAt: new Date(),
  };
}

test("only an owner is an owner", () => {
  assert.equal(isOwner(user("owner")), true);
  assert.equal(isOwner(user("employee")), false);
});

test("a signed-out visitor is never an owner", () => {
  // The UI calls this with getSession()'s result, which is null when signed out.
  assert.equal(isOwner(null), false);
});

test("owners and employees can access authoring media, signed-out visitors cannot", () => {
  assert.equal(canAccessAuthoringMedia(user("owner")), true);
  assert.equal(canAccessAuthoringMedia(user("employee")), true);
  assert.equal(canAccessAuthoringMedia(null), false);
});

test("ForbiddenError names the action it refused", () => {
  const err = new ForbiddenError("start an analysis");
  assert.equal(err.message, "Only the owner can start an analysis.");
  assert.equal(err.name, "ForbiddenError");
});
