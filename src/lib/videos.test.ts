/**
 * The feed's query parameters come straight off the URL, and `filter` and
 * `sort` choose SQL clauses. These parsers are the only thing standing between
 * an arbitrary query string and that choice, so their rejection behaviour is
 * worth pinning down.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCaptionStatus, parseDigestSort, parseReadFilter } from "./videos";

test("valid values round-trip", () => {
  assert.equal(parseCaptionStatus("available"), "available");
  assert.equal(parseReadFilter("unread"), "unread");
  assert.equal(parseReadFilter("pinned"), "pinned");
  assert.equal(parseDigestSort("views"), "views");
});

test("anything unrecognised becomes undefined, not a passthrough", () => {
  for (const junk of ["", "READ", "read_at", "1; drop table videos", undefined]) {
    assert.equal(parseCaptionStatus(junk), undefined);
    assert.equal(parseReadFilter(junk), undefined);
    assert.equal(parseDigestSort(junk), undefined);
  }
});
