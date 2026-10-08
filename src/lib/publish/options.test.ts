import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_TIKTOK_OPTIONS,
  DEFAULT_YOUTUBE_OPTIONS,
  isKidsBrand,
  parseTikTokOptions,
  parseYouTubeOptions,
  withPlatformOptions,
} from "./options";

test("publish options: defaults are private YouTube and the TikTok inbox", () => {
  for (const raw of [null, undefined, {}, [], "x", { youtube: null }]) {
    assert.deepEqual(parseYouTubeOptions(raw), { ok: true, value: DEFAULT_YOUTUBE_OPTIONS });
    assert.deepEqual(parseTikTokOptions(raw), { ok: true, value: DEFAULT_TIKTOK_OPTIONS });
  }
  assert.equal(DEFAULT_YOUTUBE_OPTIONS.privacy, "private");
  assert.equal(DEFAULT_YOUTUBE_OPTIONS.madeForKids, null);
  assert.equal(DEFAULT_TIKTOK_OPTIONS.mode, "inbox");
  assert.equal(DEFAULT_TIKTOK_OPTIONS.privacy, "SELF_ONLY");
});

test("publish options: values are read, wrong ones explained", () => {
  const yt = parseYouTubeOptions({
    youtube: {
      privacy: "unlisted",
      madeForKids: true,
      categoryId: 27,
      publishAt: "2026-10-08T15:00:00Z",
    },
    tiktok: { mode: "direct" },
  });
  assert.deepEqual(yt, {
    ok: true,
    value: {
      privacy: "unlisted",
      madeForKids: true,
      categoryId: "27",
      publishAt: "2026-10-08T15:00:00.000Z",
      notifySubscribers: true,
    },
  });
  assert.match(
    (parseYouTubeOptions({ youtube: { privacy: "friends" } }) as { error: string }).error,
    /private, unlisted or public/,
  );
  assert.equal(parseYouTubeOptions({ youtube: { madeForKids: "yes" } }).ok, false);
  assert.equal(parseYouTubeOptions({ youtube: { publishAt: "soon" } }).ok, false);
  assert.equal(parseYouTubeOptions({ youtube: { categoryId: "music" } }).ok, false);

  const tt = parseTikTokOptions({
    tiktok: { mode: "direct", privacy: "FOLLOWER_OF_CREATOR", isAigc: true },
  });
  assert.deepEqual(tt, {
    ok: true,
    value: {
      ...DEFAULT_TIKTOK_OPTIONS,
      mode: "direct",
      privacy: "FOLLOWER_OF_CREATOR",
      isAigc: true,
    },
  });
  assert.equal(parseTikTokOptions({ tiktok: { mode: "draft" } }).ok, false);
  assert.equal(parseTikTokOptions({ tiktok: { privacy: "PUBLIC" } }).ok, false);
});

test("publish options: one platform's section is replaced, the other kept", () => {
  const next = withPlatformOptions(
    { tiktok: { mode: "direct" }, other: 1 },
    "youtube",
    DEFAULT_YOUTUBE_OPTIONS,
  );
  assert.deepEqual(next, {
    tiktok: { mode: "direct" },
    other: 1,
    youtube: DEFAULT_YOUTUBE_OPTIONS,
  });
  assert.deepEqual(withPlatformOptions(null, "tiktok", DEFAULT_TIKTOK_OPTIONS), {
    tiktok: DEFAULT_TIKTOK_OPTIONS,
  });
});

test("the kids rule: cuentos and children's niches are kids brands", () => {
  assert.equal(
    isKidsBrand({ id: "cuentos", domain: "cuentos.com.py", niche: "picture books" }),
    true,
  );
  assert.equal(isKidsBrand({ id: "py-stories", niche: "cuentos infantiles" }), true);
  assert.equal(isKidsBrand({ id: "x", niche: "books for children" }), true);
  assert.equal(
    isKidsBrand({ id: "residency", domain: "paraguayresidency.co.uk", niche: "residency" }),
    false,
  );
});
