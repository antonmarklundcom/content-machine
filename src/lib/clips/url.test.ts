/**
 * The inbox's whole promise is "save it and forget it", which fails the moment
 * the same reel shows up three times because three apps appended three
 * different share fingerprints. These tests pin the dedupe key.
 */

import assert from "node:assert/strict";
import type { ClipPlatform } from "@/db/schema";
import type { UrlPlatform } from "./url";
import { test } from "node:test";
import { canonicalClipUrl, platformForUrl } from "./url";

test("platform is derived from the host, subdomains included", () => {
  assert.equal(platformForUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "youtube");
  assert.equal(platformForUrl("https://youtu.be/dQw4w9WgXcQ"), "youtube");
  assert.equal(platformForUrl("https://m.youtube.com/shorts/abc"), "youtube");
  assert.equal(platformForUrl("https://www.instagram.com/reel/Cxyz/"), "instagram");
  assert.equal(platformForUrl("https://fb.watch/xyz/"), "facebook");
  assert.equal(platformForUrl("https://web.facebook.com/reel/123"), "facebook");
  assert.equal(platformForUrl("https://www.tiktok.com/@a/video/1"), "other");
  assert.equal(platformForUrl("not a url at all"), "other");
});

test("a host that merely ends in a brand name is not that brand", () => {
  // notyoutube.com must not match youtube.com — the check is host or subdomain.
  assert.equal(platformForUrl("https://notyoutube.com/watch?v=abc"), "other");
});

test("share-sheet fingerprints do not create a second clip", () => {
  const plain = canonicalClipUrl("https://youtu.be/dQw4w9WgXcQ");
  assert.equal(canonicalClipUrl("https://youtu.be/dQw4w9WgXcQ?si=Xy7Kq2"), plain);
  assert.equal(canonicalClipUrl("http://www.youtu.be/dQw4w9WgXcQ/"), plain);
  assert.equal(
    canonicalClipUrl("https://www.instagram.com/reel/Cxyz/?igshid=abc123"),
    canonicalClipUrl("https://instagram.com/reel/Cxyz"),
  );
});

test("the content-bearing parts of a URL are left alone", () => {
  // `v` and `t` say which video and where in it — dropping them would merge
  // two different saves into one.
  assert.notEqual(
    canonicalClipUrl("https://youtube.com/watch?v=aaaaaaaaaaa"),
    canonicalClipUrl("https://youtube.com/watch?v=bbbbbbbbbbb"),
  );
  assert.equal(
    canonicalClipUrl("https://youtube.com/watch?v=aaaaaaaaaaa&t=90"),
    "https://youtube.com/watch?t=90&v=aaaaaaaaaaa",
  );
});

test("parameter order is not a difference", () => {
  assert.equal(
    canonicalClipUrl("https://example.com/p?b=2&a=1"),
    canonicalClipUrl("https://example.com/p?a=1&b=2"),
  );
});

test("anything that is not an http(s) URL is rejected outright", () => {
  assert.equal(canonicalClipUrl("javascript:alert(1)"), null);
  assert.equal(canonicalClipUrl("mailto:a@b.c"), null);
  assert.equal(canonicalClipUrl("   "), null);
});

test("utm_* campaign tags do not create a second clip", () => {
  assert.equal(
    canonicalClipUrl("https://example.com/post?utm_source=ig&utm_medium=social&UTM_Campaign=x"),
    "https://example.com/post",
  );
  assert.equal(
    canonicalClipUrl("https://youtube.com/watch?v=aaaaaaaaaaa&utm_source=share"),
    canonicalClipUrl("https://youtube.com/watch?v=aaaaaaaaaaa"),
  );
  // A parameter that merely contains "utm" is content, not a campaign tag.
  assert.equal(canonicalClipUrl("https://example.com/p?autm=1"), "https://example.com/p?autm=1");
});

// Compile-time only: the restated type and the schema's must be the same set.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _urlplatformMatchesSchema: Same<UrlPlatform, ClipPlatform> = true;
void _urlplatformMatchesSchema;
