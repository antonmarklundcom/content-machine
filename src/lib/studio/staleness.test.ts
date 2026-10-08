import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isFactStale,
  normalizeUrl,
  scriptsNeedingCorrection,
  STALE_AFTER_DAYS,
  type StalenessFact,
  type StalenessScript,
} from "./staleness";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-26T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

test("a fact is stale only once more than 90 days have passed", () => {
  assert.equal(STALE_AFTER_DAYS, 90);
  assert.equal(isFactStale(daysAgo(0), NOW), false);
  assert.equal(isFactStale(daysAgo(90), NOW), false, "exactly 90 days is still fresh");
  assert.equal(isFactStale(new Date(daysAgo(90).getTime() - 1), NOW), true);
  assert.equal(isFactStale(daysAgo(400), NOW), true);
  assert.equal(isFactStale(daysAgo(10), NOW, 7), true, "the window is a parameter");
});

test("normalizeUrl ignores case of the host, the fragment and a trailing slash", () => {
  assert.equal(normalizeUrl(" https://Example.GOV/rules/ "), "https://example.gov/rules");
  assert.equal(normalizeUrl("https://example.gov/rules#fees"), "https://example.gov/rules");
  assert.equal(normalizeUrl("https://example.gov/"), "https://example.gov");
  assert.notEqual(
    normalizeUrl("https://example.gov/a?x=1"),
    normalizeUrl("https://example.gov/a?x=2"),
  );
  assert.notEqual(
    normalizeUrl("https://example.gov/A"),
    normalizeUrl("https://example.gov/a"),
    "path case matters",
  );
  assert.equal(normalizeUrl("not a url "), "not a url");
});

const fact = (id: number, sourceUrl: string | null, updatedDaysAgo: number): StalenessFact => ({
  id,
  claim: `claim ${id}`,
  sourceUrl,
  updatedAt: daysAgo(updatedDaysAgo),
});

const script = (
  id: number,
  sourceUrls: string[],
  postedDaysAgo: number | null,
  status = "posted",
): StalenessScript => ({
  id,
  title: `script ${id}`,
  status,
  postedAt: postedDaysAgo === null ? null : daysAgo(postedDaysAgo),
  sourceUrls,
});

test("a posted script is flagged when a cited fact changed after it was posted", () => {
  const facts = [fact(1, "https://gov.py/residency", 5), fact(2, "https://gov.py/fees", 50)];
  const flagged = scriptsNeedingCorrection([script(10, ["https://gov.py/residency/"], 20)], facts);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].scriptId, 10);
  assert.deepEqual(
    flagged[0].facts.map((f) => f.id),
    [1],
    "the fees fact is not cited, so it does not count",
  );
});

test("a fact changed before posting, or not changed, flags nothing", () => {
  const facts = [fact(1, "https://gov.py/residency", 30)];
  assert.deepEqual(
    scriptsNeedingCorrection([script(10, ["https://gov.py/residency"], 20)], facts),
    [],
  );
});

test("only posted scripts with a postedAt are checked", () => {
  const facts = [fact(1, "https://gov.py/residency", 1)];
  const urls = ["https://gov.py/residency"];
  assert.deepEqual(
    scriptsNeedingCorrection(
      [script(1, urls, 20, "draft"), script(2, urls, 20, "recorded"), script(3, urls, null)],
      facts,
    ),
    [],
  );
});

test("facts without a source never match, and a script lists each fact once", () => {
  const facts = [
    fact(1, null, 1),
    fact(2, "  ", 1),
    fact(3, "https://a.example/x", 1),
    fact(4, "https://a.example/x#top", 2),
  ];
  const flagged = scriptsNeedingCorrection(
    [script(7, ["https://a.example/x", "https://A.example/x/", ""], 10)],
    facts,
  );
  assert.equal(flagged.length, 1);
  assert.deepEqual(
    flagged[0].facts.map((f) => f.id),
    [4, 3],
    "both facts on that URL, oldest change first, no duplicates",
  );
});

test("flagged scripts come newest-posted first", () => {
  const facts = [fact(1, "https://a.example/x", 1)];
  const urls = ["https://a.example/x"];
  const flagged = scriptsNeedingCorrection(
    [script(1, urls, 30), script(2, urls, 5), script(3, urls, 12)],
    facts,
  );
  assert.deepEqual(
    flagged.map((f) => f.scriptId),
    [2, 3, 1],
  );
});
