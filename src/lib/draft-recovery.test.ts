import assert from "node:assert/strict";
import { test } from "node:test";
import { draftKey, readDraft, writeDraft } from "./draft-recovery";

type Draft = { title: string; slides: { n: number; body: string }[] };
const valid = (value: unknown): value is Draft =>
  !!value &&
  typeof value === "object" &&
  typeof (value as Draft).title === "string" &&
  Array.isArray((value as Draft).slides);

test("draft storage preserves edited text and ordering across navigation/reload and retains its conflict base", () => {
  const value = {
    title: "Unsaved copy",
    slides: [
      { n: 2, body: "Second first" },
      { n: 1, body: "First second" },
    ],
  };
  const recovered = readDraft(writeDraft("revision:4", value, 1000), valid, 2000);
  assert.deepEqual(recovered?.value, value);
  assert.equal(recovered?.base, "revision:4");
  assert.notEqual(
    recovered?.base,
    "revision:5",
    "refresh/reopen can detect a changed saved revision",
  );
  assert.notEqual(draftKey(1, "brand-a", "post", 8), draftKey(2, "brand-a", "post", 8));
  assert.notEqual(draftKey(1, "brand-a", "post", 8), draftKey(1, "brand-b", "post", 8));
  assert.notEqual(draftKey(1, "brand-a", "post", 8), draftKey(1, "brand-a", "script", 8));
});

test("malformed and expired browser drafts do not replace the saved copy", () => {
  assert.equal(readDraft("{broken", valid), null);
  assert.equal(readDraft(writeDraft("base", { title: 4 }, 1000), valid, 2000), null);
  assert.equal(
    readDraft(writeDraft("base", { title: "old", slides: [] }, 1000), valid, 8 * 24 * 60 * 60_000),
    null,
  );
});
