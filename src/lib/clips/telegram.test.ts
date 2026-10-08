import assert from "node:assert/strict";
import type { ClipPurpose } from "@/db/schema";
import type { CapturePurpose } from "./telegram";
import { test } from "node:test";

import { parseCaptureMessage } from "./telegram";

/** The Telegram capture grammar (PLAN.md §1.43). */

const ALIASES = { guia: "guide", residencia: "residenciaes", pozo: "pozo" };

test("URL, brand, purpose, tags and note are each picked out", () => {
  assert.deepEqual(
    parseCaptureMessage(
      "https://www.instagram.com/reel/Cxyz/?igshid=abc #guide #factcheck #Visa says 90 days?",
      ALIASES,
    ),
    {
      url: "https://instagram.com/reel/Cxyz",
      rawUrl: "https://www.instagram.com/reel/Cxyz/?igshid=abc",
      brandId: "guide",
      purpose: "fact_check",
      tags: ["visa"],
      note: "says 90 days?",
    },
  );
});

test("an alias names its brand, and the first brand and purpose win", () => {
  const parsed = parseCaptureMessage(
    "look #residencia #pozo #inspo #competitor https://youtu.be/abc",
    ALIASES,
  );
  assert.equal(parsed.brandId, "residenciaes");
  assert.equal(parsed.purpose, "inspo");
  assert.deepEqual(parsed.tags, ["pozo"], "a second brand is kept as a tag, not lost");
  assert.equal(parsed.note, "look");
  assert.equal(parsed.url, "https://youtu.be/abc");
});

test("only the first URL is the clip; later ones stay in the note", () => {
  const parsed = parseCaptureMessage("https://a.example/one, compare https://b.example/two.", {});
  assert.equal(parsed.url, "https://a.example/one");
  assert.equal(parsed.note, ", compare https://b.example/two.");
});

test("a URL fragment is not read as a hashtag", () => {
  const parsed = parseCaptureMessage("https://example.com/page#section #own", {});
  assert.equal(parsed.rawUrl, "https://example.com/page#section");
  assert.equal(parsed.url, "https://example.com/page");
  assert.equal(parsed.purpose, "own");
  assert.deepEqual(parsed.tags, []);
});

test("no URL, no hashtags, and repeated tags", () => {
  assert.deepEqual(parseCaptureMessage("  just a thought  ", ALIASES), {
    url: null,
    rawUrl: null,
    brandId: null,
    purpose: null,
    tags: [],
    note: "just a thought",
  });
  const tagsOnly = parseCaptureMessage("#Tax #tax #IVA", {});
  assert.deepEqual(tagsOnly.tags, ["tax", "iva"]);
  assert.equal(tagsOnly.note, null);
});

test("a non-http link is kept as text but is not a clip", () => {
  const parsed = parseCaptureMessage("mailto:a@b.c #own", {});
  assert.equal(parsed.url, null);
  assert.equal(parsed.note, "mailto:a@b.c");
});

// Compile-time only: the restated type and the schema's must be the same set.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _capturepurposeMatchesSchema: Same<CapturePurpose, ClipPurpose> = true;
void _capturepurposeMatchesSchema;
