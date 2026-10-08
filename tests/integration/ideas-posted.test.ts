import { insertReturning } from "@/db/mutations";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { db, schema } from "@/db";
import { PATCH } from "@/app/api/ideas/[id]/route";

import { resetTables, teardown } from "./setup";

/**
 * `posted` and `posted_at` (PLAN.md §1.23). The stamp describes the current
 * status: set on the way into `posted`, kept on a repeat, cleared on the way out.
 */

async function seedIdea(): Promise<number> {
  const [idea] = await insertReturning(
    db,
    schema.ideas,
    {
      brandId: "residency-guide",
      title: "The 45-day timeline",
      angle: "Everyone still quotes 90 days.",
      format: "carousel",
      platform: "instagram",
      draftCopy: "45 días.",
    },
    { id: schema.ideas.id },
  );
  return idea.id;
}

async function patch(id: number, body: unknown) {
  const response = await PATCH(
    new Request(`http://localhost/api/ideas/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(resetTables);
after(teardown);

test("posted stamps posted_at, a repeat keeps it, leaving clears it", async () => {
  const id = await seedIdea();

  const posted = await patch(id, { status: "posted" });
  assert.equal(posted.status, 200);
  assert.equal(posted.body.status, "posted");
  assert.ok(posted.body.postedAt, "stamped on the transition in");

  await new Promise((resolve) => setTimeout(resolve, 20));
  const again = await patch(id, { status: "posted" });
  assert.equal(again.body.postedAt, posted.body.postedAt, "a repeat keeps the first stamp");

  const back = await patch(id, { status: "approved" });
  assert.equal(back.body.status, "approved");
  assert.equal(back.body.postedAt, null, "cleared on the way out");
});

test("edits that do not touch status leave posted_at alone", async () => {
  const id = await seedIdea();
  const posted = await patch(id, { status: "posted" });

  const edited = await patch(id, { title: "Retitled after posting" });
  assert.equal(edited.body.postedAt, posted.body.postedAt);
});

test("an unknown status is still 400, and a missing idea 404", async () => {
  const id = await seedIdea();
  assert.equal((await patch(id, { status: "scheduled" })).status, 400);
  assert.equal((await patch(id + 1000, { status: "posted" })).status, 404);
});
