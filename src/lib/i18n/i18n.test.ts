/**
 * The dictionary is the UI's only copy, so the invariants worth testing are:
 * both languages cover the same keys, interpolation works, and a missing
 * translation degrades to English rather than to a raw key.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { en, sv } from "./dictionary";
import { isLocale, translator } from ".";
import * as app from "./dict/app";
import * as inbox from "./dict/inbox";
import * as nav from "./dict/nav";
import * as promote from "./dict/promote";
import * as spend from "./dict/spend";
import * as video from "./dict/video";
import * as youtube from "./dict/youtube";

test("sv covers every en key and leaves none empty", () => {
  const missing = Object.keys(en).filter((key) => !(key in sv));
  assert.deepEqual(missing, []);
  const blank = Object.entries(sv).filter(([, value]) => value.trim() === "");
  assert.deepEqual(blank, []);
});

test("the per-feature split kept the key set exactly (PLAN.md §1.26)", () => {
  // Snapshot taken from the single-file dictionary before O6 split it. Pinned
  // against the files the split produced, not against the whole dictionary, so
  // lane 2 can add keys to its own file without touching the snapshot; a key
  // lost, renamed or shadowed by a spread fails here.
  const snapshot = JSON.parse(
    readFileSync(new URL("./keys.snapshot.json", import.meta.url), "utf8"),
  ) as string[];
  const split = [app, nav, spend, youtube, video, inbox, promote];
  assert.deepEqual(split.flatMap((d) => Object.keys(d.en)).sort(), snapshot);
  assert.deepEqual(split.flatMap((d) => Object.keys(d.sv)).sort(), snapshot);
  for (const key of snapshot) {
    assert.ok(key in en && key in sv, `${key} survives the spread`);
  }
});

test("sv is not a copy of en", () => {
  // A few keys are legitimately identical (proper nouns, "Hook"); most are not.
  const identical = Object.keys(en).filter(
    (key) => sv[key as keyof typeof sv] === en[key as keyof typeof en],
  );
  assert.ok(
    identical.length < Object.keys(en).length / 4,
    `${identical.length} of ${Object.keys(en).length} sv strings are identical to en`,
  );
});

test("interpolation replaces known vars and leaves unknown ones alone", () => {
  const t = translator("en");
  assert.equal(t("pagination.position", { page: 2, total: 7 }), "Page 2 of 7");
  assert.equal(t("pagination.position", { page: 2 }), "Page 2 of {total}");
});

test("translator falls back to English for a missing translation", () => {
  const t = translator("sv");
  // Cast: the point is behaviour when a key is absent from the sv map at runtime.
  const partial = sv as Record<string, string | undefined>;
  const original = partial["nav.digest"];
  delete partial["nav.digest"];
  assert.equal(t("nav.digest"), en["nav.digest"]);
  partial["nav.digest"] = original;
});

test("isLocale rejects anything not shipped", () => {
  assert.equal(isLocale("sv"), true);
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("de"), false);
  assert.equal(isLocale(undefined), false);
});
