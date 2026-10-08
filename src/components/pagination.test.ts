import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHref } from "./Pagination";

test("a page link stays on the listing it was rendered from", () => {
  // The regression this pins: the base path was hardcoded to "/", so page 2 of
  // a topic shelf silently became page 2 of the whole corpus.
  const params = new URLSearchParams({ sort: "views", page: "1" });
  assert.equal(buildHref("/topics/topic/seo", params, 2), "/topics/topic/seo?sort=views&page=2");
  assert.equal(
    buildHref("/marks", new URLSearchParams({ type: "idea" }), 3),
    "/marks?type=idea&page=3",
  );
});

test("the feed is still the default shape", () => {
  assert.equal(buildHref("/", new URLSearchParams({ q: "seo" }), 2), "/?q=seo&page=2");
});

test("the existing page param is replaced, not appended twice", () => {
  const params = new URLSearchParams({ page: "7" });
  assert.equal(buildHref("/", params, 2), "/?page=2");
});

test("the caller's params object is not mutated", () => {
  // It is the same URLSearchParams for both the previous and the next link.
  const params = new URLSearchParams({ page: "4" });
  buildHref("/", params, 9);
  assert.equal(params.get("page"), "4");
});
