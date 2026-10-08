/**
 * The results dashboard's arithmetic (build 4 §3.G). Pure: rows in, numbers
 * out; `load.ts` does the reading.
 *
 * Engagement rate is the one "what worked" uses (PLAN.md §1.51,
 * src/lib/posts/what-worked.ts): (saves + shares + comments) / reach, on each
 * post's newest `post_metrics` snapshot. Likes are shown but not counted —
 * they are the cheapest signal and the one least tied to leads. A post without
 * reach has no rate (a rate over nothing says nothing) and is left out of rate
 * averages and the top list, but still counted as a post.
 */

export type MetricSnapshot = {
  postId: number;
  capturedAt: Date;
  id: number;
  reach: number | null;
  impressions: number | null;
  plays: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  follows: number | null;
};

export type ResultPost = {
  id: number;
  accountId: number;
  handle: string;
  platform: string;
  language: string;
  format: string;
  title: string;
  hook: string;
  /** The post body's engagement mechanic (src/lib/posts/contract.ts); null without a body. */
  mechanic: string | null;
  publishedAt: Date | null;
  permalink: string | null;
  metrics: MetricSnapshot | null;
};

/** The newest snapshot per post: latest `capturedAt`, then highest id on a tie. */
export function latestSnapshots(rows: MetricSnapshot[]): Map<number, MetricSnapshot> {
  const out = new Map<number, MetricSnapshot>();
  for (const r of rows) {
    const cur = out.get(r.postId);
    if (
      !cur ||
      r.capturedAt.getTime() > cur.capturedAt.getTime() ||
      (r.capturedAt.getTime() === cur.capturedAt.getTime() && r.id > cur.id)
    ) {
      out.set(r.postId, r);
    }
  }
  return out;
}

export function engagementRate(
  m: Pick<MetricSnapshot, "reach" | "saves" | "shares" | "comments"> | null,
): number | null {
  if (!m || !m.reach || m.reach <= 0) return null;
  return ((m.saves ?? 0) + (m.shares ?? 0) + (m.comments ?? 0)) / m.reach;
}

export type HookShape = "question" | "number" | "how_to" | "negation" | "statement" | "none";

/**
 * A rough shape for a hook, so hooks can be compared by kind: a question, one
 * that leads with a number, a how-to, a myth/negation, or a plain statement.
 * Covers en/es/pt/sv wording; anything else is a statement.
 */
export function hookShape(hook: string): HookShape {
  const h = hook.trim().toLowerCase();
  if (!h) return "none";
  if (/[?¿]/.test(h)) return "question";
  if (/^(\d|uno|dos|tres|cinco|one|two|three|five|top\b)/.test(h)) return "number";
  if (/^(how to|how i|cómo|como|así|asi|hur du|så )/.test(h)) return "how_to";
  if (/(\bnot\b|\bno\b|\bnunca\b|\bnever\b|\bmyth|\bmito|\binte\b|\baldrig\b|n't\b)/.test(h)) {
    return "negation";
  }
  return "statement";
}

export type GroupStats = {
  key: string;
  posts: number;
  /** Posts with a snapshot at all. */
  measured: number;
  /** Posts with reach > 0, the ones the rate is averaged over. */
  rated: number;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  /** Mean of per-post rates (each post counts once, whatever its reach); null with none rated. */
  avgRate: number | null;
  /** Pooled rate: sum of (saves + shares + comments) over sum of reach of rated posts. */
  pooledRate: number | null;
};

/** Group posts by `keyOf` and add up their newest metrics. Sorted by avgRate, then post count. */
export function aggregateBy(posts: ResultPost[], keyOf: (p: ResultPost) => string): GroupStats[] {
  const groups = new Map<string, ResultPost[]>();
  for (const p of posts) {
    const key = keyOf(p);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const out: GroupStats[] = [];
  for (const [key, list] of groups) {
    const s: GroupStats = {
      key,
      posts: list.length,
      measured: 0,
      rated: 0,
      reach: 0,
      likes: 0,
      comments: 0,
      saves: 0,
      shares: 0,
      avgRate: null,
      pooledRate: null,
    };
    let rateSum = 0;
    let ratedReach = 0;
    let ratedActions = 0;
    for (const p of list) {
      const m = p.metrics;
      if (!m) continue;
      s.measured++;
      s.reach += m.reach ?? 0;
      s.likes += m.likes ?? 0;
      s.comments += m.comments ?? 0;
      s.saves += m.saves ?? 0;
      s.shares += m.shares ?? 0;
      const rate = engagementRate(m);
      if (rate === null) continue;
      s.rated++;
      rateSum += rate;
      ratedReach += m.reach ?? 0;
      ratedActions += (m.saves ?? 0) + (m.shares ?? 0) + (m.comments ?? 0);
    }
    if (s.rated > 0) {
      s.avgRate = rateSum / s.rated;
      s.pooledRate = ratedReach > 0 ? ratedActions / ratedReach : null;
    }
    out.push(s);
  }
  return out.sort(
    (a, b) =>
      (b.avgRate ?? -1) - (a.avgRate ?? -1) || b.posts - a.posts || a.key.localeCompare(b.key),
  );
}

export type RankedPost = ResultPost & { rate: number };

/** The `limit` posts with the highest rate; ties go to the larger reach, then the newer post. */
export function topPosts(posts: ResultPost[], limit = 10): RankedPost[] {
  const ranked: RankedPost[] = [];
  for (const p of posts) {
    const rate = engagementRate(p.metrics);
    if (rate !== null) ranked.push({ ...p, rate });
  }
  return ranked
    .sort(
      (a, b) =>
        b.rate - a.rate ||
        (b.metrics?.reach ?? 0) - (a.metrics?.reach ?? 0) ||
        (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
    )
    .slice(0, limit);
}

export type FollowerPoint = { date: string; followers: number };

export type FollowerTrend = {
  points: FollowerPoint[];
  start: number | null;
  end: number | null;
  delta: number | null;
};

/** Daily follower counts in date order, days without a count dropped. */
export function followerTrend(rows: { date: string; followers: number | null }[]): FollowerTrend {
  const points = rows
    .filter((r): r is FollowerPoint => typeof r.followers === "number")
    .map((r) => ({ date: r.date, followers: r.followers }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (points.length === 0) return { points, start: null, end: null, delta: null };
  const start = points[0].followers;
  const end = points[points.length - 1].followers;
  return { points, start, end, delta: end - start };
}

/**
 * An SVG polyline `points` string for a sparkline `width`×`height`, with
 * `pad` px inside the edges. One value draws a flat line; none, "".
 */
export function sparklinePoints(values: number[], width = 120, height = 28, pad = 2): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const xs = values.length === 1 ? [0, w] : values.map((_, i) => (i / (values.length - 1)) * w);
  const ys = (values.length === 1 ? [values[0], values[0]] : values).map((v) =>
    span === 0 ? h / 2 : h - ((v - min) / span) * h,
  );
  return xs.map((x, i) => `${(x + pad).toFixed(1)},${(ys[i] + pad).toFixed(1)}`).join(" ");
}

/** Totals across every post in range. */
export function totals(posts: ResultPost[]): GroupStats {
  return aggregateBy(posts, () => "all")[0] ?? emptyStats();
}

function emptyStats(): GroupStats {
  return {
    key: "all",
    posts: 0,
    measured: 0,
    rated: 0,
    reach: 0,
    likes: 0,
    comments: 0,
    saves: 0,
    shares: 0,
    avgRate: null,
    pooledRate: null,
  };
}
