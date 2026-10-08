import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLeadUrl, leadBaseProblem, LeadUrlError, utmToken } from "./url";

const parts = { platform: "instagram", accountHandle: "@ParaguayResidency", postId: 42 };

test("a bare base gets all four UTMs, campaign from the handle", () => {
  assert.equal(
    buildLeadUrl("https://example.com/contact", parts),
    "https://example.com/contact?utm_source=instagram&utm_medium=social&utm_campaign=paraguayresidency&utm_content=post-42",
  );
});

test("existing params are kept byte for byte and new ones appended", () => {
  assert.equal(
    buildLeadUrl("https://crm.example.com/f/abc?lang=es&ref=a%20b", parts),
    "https://crm.example.com/f/abc?lang=es&ref=a%20b&utm_source=instagram&utm_medium=social&utm_campaign=paraguayresidency&utm_content=post-42",
  );
});

test("a fragment stays at the end", () => {
  assert.equal(
    buildLeadUrl("https://example.com/landing?x=1#form", { ...parts, campaign: "Spring 2026" }),
    "https://example.com/landing?x=1&utm_source=instagram&utm_medium=social&utm_campaign=spring-2026&utm_content=post-42#form",
  );
  assert.equal(
    buildLeadUrl("https://example.com/#top", parts),
    "https://example.com/?utm_source=instagram&utm_medium=social&utm_campaign=paraguayresidency&utm_content=post-42#top",
  );
});

test("UTMs already on the base win and are never duplicated", () => {
  const url = buildLeadUrl("https://example.com/?utm_campaign=residency&utm_source=ig", parts);
  assert.equal(
    url,
    "https://example.com/?utm_campaign=residency&utm_source=ig&utm_medium=social&utm_content=post-42",
  );
  const all = "https://example.com/?utm_source=a&utm_medium=b&utm_campaign=c&utm_content=d";
  assert.equal(buildLeadUrl(all, parts), all);
});

test("a trailing ? or & does not double up", () => {
  assert.match(buildLeadUrl("https://example.com/?", parts), /\/\?utm_source=/);
  assert.match(buildLeadUrl("https://example.com/?a=1&", parts), /a=1&utm_source=/);
});

test("bad bases are refused", () => {
  assert.throws(() => buildLeadUrl("example.com", parts), LeadUrlError);
  assert.throws(() => buildLeadUrl("javascript:alert(1)", parts), LeadUrlError);
  assert.throws(() => buildLeadUrl("  ", parts), LeadUrlError);
  assert.equal(leadBaseProblem("https://example.com"), null);
});

test("utmToken normalises handles and campaigns", () => {
  assert.equal(utmToken("@Mi Cuenta!"), "mi-cuenta");
  assert.equal(utmToken("realestate_py"), "realestate_py");
  assert.equal(utmToken(""), "");
});
