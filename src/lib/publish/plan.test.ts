import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isShort,
  MAX_ATTEMPTS,
  nextAttemptAt,
  planAssets,
  planPublish,
  PUBLISHABLE_PLATFORMS,
  retryDue,
  TEMPORARY_PREFIX,
  type PlanAsset,
  type PublishPlan,
} from "./plan";

const img = (n: number, role: PlanAsset["role"] = "slide"): PlanAsset => ({
  assetId: n,
  kind: "image",
  role,
  position: n,
  name: `0${n}.jpg`,
  altText: null,
});
const vid = (n: number, role: PlanAsset["role"] = "clip"): PlanAsset => ({
  ...img(n, role),
  kind: "video",
  name: `0${n}.mp4`,
});

test("plan: every IG and FB media type maps to its Graph shape", () => {
  const ig = (format: Parameters<typeof planPublish>[0]["format"], assets: PlanAsset[]) =>
    planPublish({ platform: "instagram", format, caption: "hi", assets });
  const fb = (format: Parameters<typeof planPublish>[0]["format"], assets: PlanAsset[]) =>
    planPublish({ platform: "facebook", format, caption: "hi", assets });

  assert.deepEqual(ig("image_post", [img(1)]), {
    ok: true,
    plan: { platform: "instagram", kind: "image", media: [img(1)] },
  });
  // A lone cover is the image of an image post.
  assert.equal((ig("image_post", [img(1, "cover")]) as { ok: true }).ok, true);
  const carousel = ig("carousel", [img(3), vid(2), img(1)]);
  assert.ok(carousel.ok && carousel.plan.kind === "carousel");
  assert.deepEqual(
    carousel.ok && carousel.plan.media.map((m) => m.assetId),
    [1, 2, 3],
    "ordered by position",
  );
  const reel = ig("reel", [vid(1), img(2, "cover"), img(3, "thumbnail")]);
  assert.ok(reel.ok && reel.plan.kind === "reel" && reel.plan.cover?.assetId === 2);
  assert.deepEqual(reel.ok && planAssets(reel.plan).map((a) => a.assetId), [1, 2]);
  assert.ok(ig("video", [vid(1)]).ok, "an IG video goes out as a reel");

  assert.ok(
    (fb("image_post", [img(1)]) as { ok: true; plan: { kind: string } }).plan.kind === "photo",
  );
  assert.equal(
    (fb("carousel", [img(1), img(2)]) as { ok: true; plan: { kind: string } }).plan.kind,
    "album",
  );
  assert.equal((fb("reel", [vid(1)]) as { ok: true; plan: { kind: string } }).plan.kind, "video");
  assert.equal((fb("text", []) as { ok: true; plan: { kind: string } }).plan.kind, "text");
});

test("plan: what cannot be published says why", () => {
  const err = (r: ReturnType<typeof planPublish>) => (r.ok ? "" : r.error);
  const base = { caption: "hi" };
  assert.match(
    err(planPublish({ ...base, platform: "threads", format: "reel", assets: [vid(1)] })),
    /threads is not built/,
  );
  assert.match(
    err(planPublish({ ...base, platform: "instagram", format: "image_post", assets: [] })),
    /exactly one image.*none/,
  );
  assert.match(
    err(
      planPublish({
        ...base,
        platform: "instagram",
        format: "image_post",
        assets: [img(1), img(2)],
      }),
    ),
    /carousel format/,
  );
  assert.match(
    err(planPublish({ ...base, platform: "instagram", format: "carousel", assets: [img(1)] })),
    /2–10 slides/,
  );
  const eleven = Array.from({ length: 11 }, (_, i) => img(i + 1));
  assert.match(
    err(planPublish({ ...base, platform: "instagram", format: "carousel", assets: eleven })),
    /11 image/,
  );
  assert.match(
    err(
      planPublish({ ...base, platform: "facebook", format: "carousel", assets: [img(1), vid(2)] }),
    ),
    /images only/,
  );
  assert.match(
    err(planPublish({ ...base, platform: "instagram", format: "reel", assets: [img(1)] })),
    /exactly one video/,
  );
  assert.match(
    err(planPublish({ ...base, platform: "instagram", format: "story", assets: [img(1)] })),
    /Stories/,
  );
  assert.match(
    err(planPublish({ ...base, platform: "instagram", format: "text", assets: [] })),
    /no text-only/,
  );
  assert.match(
    err(planPublish({ platform: "facebook", format: "text", caption: " ", assets: [] })),
    /needs a caption/,
  );
  assert.match(
    err(
      planPublish({
        platform: "instagram",
        format: "image_post",
        caption: "x".repeat(2201),
        assets: [img(1)],
      }),
    ),
    /2201 characters/,
  );
  const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ");
  assert.match(
    err(
      planPublish({ platform: "instagram", format: "image_post", caption: tags, assets: [img(1)] }),
    ),
    /31 hashtags/,
  );
});

test("plan: YouTube and TikTok take one video; Shorts are vertical and at most 3 minutes", () => {
  const sized = (w: number, h: number, d: number | null): PlanAsset => ({
    ...vid(2),
    width: w,
    height: h,
    durationSec: d,
  });
  const thumb = { ...img(3, "thumbnail") };
  const yt = planPublish({
    platform: "youtube",
    format: "video",
    caption: "hi",
    assets: [thumb, sized(1920, 1080, 600)],
  });
  assert.deepEqual(yt, {
    ok: true,
    plan: {
      platform: "youtube",
      kind: "video",
      media: [sized(1920, 1080, 600)],
      thumbnail: thumb,
      short: false,
    },
  });
  assert.deepEqual(planAssets((yt as { ok: true; plan: PublishPlan }).plan), [
    sized(1920, 1080, 600),
    thumb,
  ]);
  const short = (a: PlanAsset) =>
    (
      planPublish({ platform: "youtube", format: "reel", caption: "", assets: [a] }) as {
        ok: true;
        plan: { short: boolean };
      }
    ).plan.short;
  assert.equal(short(sized(1080, 1920, 59)), true);
  assert.equal(short(sized(1080, 1920, 180)), true);
  assert.equal(short(sized(1080, 1920, 181)), false, "over 3 minutes");
  assert.equal(short(sized(1080, 1080, 30)), false, "square is not vertical");
  assert.equal(short(sized(1080, 1920, null)), false, "unknown length");
  assert.equal(isShort({ width: null, height: null, durationSec: 10 }), false);

  assert.deepEqual(
    planPublish({ platform: "tiktok", format: "reel", caption: "hi", assets: [vid(1)] }),
    { ok: true, plan: { platform: "tiktok", kind: "video", media: [vid(1)] } },
  );

  const err = (r: ReturnType<typeof planPublish>) => (r.ok ? "" : r.error);
  assert.match(
    err(planPublish({ platform: "youtube", format: "image_post", caption: "", assets: [img(1)] })),
    /YouTube takes video and reel posts.*image post/,
  );
  assert.match(
    err(planPublish({ platform: "tiktok", format: "carousel", caption: "", assets: [img(1)] })),
    /TikTok takes video and reel posts/,
  );
  assert.match(
    err(planPublish({ platform: "tiktok", format: "video", caption: "", assets: [img(1)] })),
    /exactly one video.*1 image/,
  );
  assert.match(
    err(
      planPublish({
        platform: "tiktok",
        format: "video",
        caption: "x".repeat(2201),
        assets: [vid(1)],
      }),
    ),
    /TikTok allows 2200/,
  );
  assert.ok(PUBLISHABLE_PLATFORMS.includes("youtube") && PUBLISHABLE_PLATFORMS.includes("tiktok"));
});

test("backoff: 5, 10, 20 minutes; only temporary failures; at most MAX_ATTEMPTS", () => {
  const t0 = new Date("2026-09-27T10:00:00Z");
  assert.equal(nextAttemptAt(1, t0)?.toISOString(), "2026-09-27T10:05:00.000Z");
  assert.equal(nextAttemptAt(2, t0)?.toISOString(), "2026-09-27T10:10:00.000Z");
  assert.equal(nextAttemptAt(3, t0)?.toISOString(), "2026-09-27T10:20:00.000Z");
  const post = {
    publishAttempts: 1,
    lastPublishAttemptAt: t0,
    publishError: `${TEMPORARY_PREFIX}rate limited`,
  };
  assert.equal(retryDue(post, new Date("2026-09-27T10:04:00Z")), false);
  assert.equal(retryDue(post, new Date("2026-09-27T10:05:00Z")), true);
  assert.equal(
    retryDue({ ...post, publishError: "Meta refused: bad image" }, new Date("2026-09-28")),
    false,
  );
  assert.equal(retryDue({ ...post, publishAttempts: MAX_ATTEMPTS }, new Date("2026-09-28")), false);
});
