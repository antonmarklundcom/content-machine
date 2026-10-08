import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aggregateBy,
  engagementRate,
  followerTrend,
  hookShape,
  latestSnapshots,
  sparklinePoints,
  topPosts,
  totals,
  type MetricSnapshot,
  type ResultPost,
} from "./aggregate";
import { resultsRange } from "./range";

const snap = (postId: number, id: number, at: string, m: Partial<MetricSnapshot> = {}) => ({
  postId,
  id,
  capturedAt: new Date(at),
  reach: null,
  impressions: null,
  plays: null,
  likes: null,
  comments: null,
  saves: null,
  shares: null,
  follows: null,
  ...m,
});

function post(id: number, p: Partial<ResultPost> = {}): ResultPost {
  return {
    id,
    accountId: 1,
    handle: "acc",
    platform: "instagram",
    language: "es-PY",
    format: "carousel",
    title: `Post ${id}`,
    hook: "",
    mechanic: null,
    publishedAt: new Date(`2026-09-${String(id).padStart(2, "0")}T12:00:00Z`),
    permalink: null,
    metrics: null,
    ...p,
  };
}

test("latestSnapshots keeps the newest capture per post, highest id on a tie", () => {
  const map = latestSnapshots([
    snap(1, 1, "2026-09-01", { reach: 10 }),
    snap(1, 3, "2026-09-03", { reach: 30 }),
    snap(1, 2, "2026-09-02", { reach: 20 }),
    snap(2, 4, "2026-09-05", { reach: 1 }),
    snap(2, 5, "2026-09-05", { reach: 2 }),
  ]);
  assert.equal(map.get(1)?.reach, 30);
  assert.equal(map.get(2)?.reach, 2);
  assert.equal(map.size, 2);
});

test("engagementRate is (saves+shares+comments)/reach and null without reach", () => {
  assert.equal(engagementRate({ reach: 200, saves: 10, shares: 5, comments: 5 }), 0.1);
  assert.equal(engagementRate({ reach: 0, saves: 10, shares: 5, comments: 5 }), null);
  assert.equal(engagementRate({ reach: null, saves: 1, shares: 1, comments: 1 }), null);
  assert.equal(engagementRate(null), null);
  assert.equal(engagementRate({ reach: 100, saves: null, shares: null, comments: 2 }), 0.02);
});

test("aggregateBy counts posts without metrics but leaves them out of rates", () => {
  const posts = [
    post(1, {
      format: "reel",
      metrics: snap(1, 1, "2026-09-02", { reach: 100, saves: 10, likes: 5 }),
    }),
    post(2, { format: "reel", metrics: snap(2, 2, "2026-09-02", { reach: 300, comments: 10 }) }),
    post(3, { format: "reel" }),
    post(4, { format: "carousel", metrics: snap(4, 3, "2026-09-02", { likes: 7 }) }),
  ];
  const groups = aggregateBy(posts, (p) => p.format);
  const reel = groups.find((g) => g.key === "reel")!;
  assert.equal(reel.posts, 3);
  assert.equal(reel.measured, 2);
  assert.equal(reel.rated, 2);
  assert.equal(reel.reach, 400);
  assert.equal(reel.likes, 5);
  assert.ok(Math.abs(reel.avgRate! - (0.1 + 10 / 300) / 2) < 1e-9);
  assert.ok(Math.abs(reel.pooledRate! - 20 / 400) < 1e-9);
  const carousel = groups.find((g) => g.key === "carousel")!;
  assert.equal(carousel.measured, 1);
  assert.equal(carousel.rated, 0);
  assert.equal(carousel.avgRate, null);
  assert.equal(groups[0].key, "reel", "rated groups sort first");
});

test("no posts, no metrics: empty groups, empty totals, empty top list", () => {
  assert.deepEqual(
    aggregateBy([], (p) => p.format),
    [],
  );
  const t = totals([]);
  assert.equal(t.posts, 0);
  assert.equal(t.avgRate, null);
  assert.deepEqual(topPosts([post(1), post(2)]), []);
  assert.equal(totals([post(1)]).posts, 1);
});

test("topPosts ranks by rate, then reach, and caps the list", () => {
  const posts = Array.from({ length: 14 }, (_, i) =>
    post(i + 1, { metrics: snap(i + 1, i + 1, "2026-09-20", { reach: 100, saves: i }) }),
  );
  posts.push(post(20, { metrics: snap(20, 99, "2026-09-20", { reach: 1000, saves: 130 }) }));
  const top = topPosts(posts, 10);
  assert.equal(top.length, 10);
  assert.equal(top[0].id, 20, "0.13 ties with 0.13; the larger reach wins");
  assert.equal(top[1].id, 14);
  assert.ok(top.every((p, i) => i === 0 || p.rate <= top[i - 1].rate));
});

test("hookShape classifies common hook kinds", () => {
  assert.equal(hookShape("¿Sabías que la residencia tarda 45 días?"), "question");
  assert.equal(hookShape("3 errores al pedir la cédula"), "number");
  assert.equal(hookShape("Cómo sacar la residencia"), "how_to");
  assert.equal(hookShape("Nunca firmes esto sin leer"), "negation");
  assert.equal(hookShape("Paraguay is cheap to live in"), "statement");
  assert.equal(hookShape("  "), "none");
});

test("followerTrend drops empty days and measures the change", () => {
  const t = followerTrend([
    { date: "2026-09-03", followers: 130 },
    { date: "2026-09-01", followers: 100 },
    { date: "2026-09-02", followers: null },
  ]);
  assert.deepEqual(
    t.points.map((p) => p.date),
    ["2026-09-01", "2026-09-03"],
  );
  assert.equal(t.delta, 30);
  assert.deepEqual(followerTrend([]), { points: [], start: null, end: null, delta: null });
});

test("sparklinePoints spans the box and handles flat and single series", () => {
  assert.equal(sparklinePoints([]), "");
  assert.equal(sparklinePoints([5], 100, 20, 0), "0.0,10.0 100.0,10.0");
  assert.equal(sparklinePoints([1, 1], 100, 20, 0), "0.0,10.0 100.0,10.0");
  assert.equal(sparklinePoints([0, 10], 100, 20, 0), "0.0,20.0 100.0,0.0");
});

test("resultsRange defaults to 90 days and accepts days or from/to", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const def = resultsRange({}, now);
  assert.equal(def.days, 90);
  assert.equal(def.to, now);
  assert.equal(resultsRange({ days: "30" }, now).days, 30);
  assert.equal(resultsRange({ days: "-4" }, now).days, 90);
  const r = resultsRange({ from: "2026-09-01", to: "2026-09-30" }, now);
  assert.equal(r.from.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(r.to.toISOString(), "2026-09-30T23:59:59.999Z");
  assert.equal(resultsRange({ from: "2026-09-30", to: "2026-09-01" }, now).days, 90);
});
