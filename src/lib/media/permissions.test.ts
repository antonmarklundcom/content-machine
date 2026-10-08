import assert from "node:assert/strict";
import { test } from "node:test";
import type { User } from "@/db/schema";
import { authoringMediaDenied } from "./permissions";

function user(role: User["role"]): User {
  return {
    id: 1,
    email: "author@example.com",
    role,
    passwordHash: null,
    createdAt: new Date(),
  };
}

test("media read routes allow both signed-in roles and reject signed-out requests", () => {
  assert.equal(authoringMediaDenied(user("owner")), null);
  assert.equal(authoringMediaDenied(user("employee")), null);
  assert.equal(authoringMediaDenied(null)?.status, 401);
});
