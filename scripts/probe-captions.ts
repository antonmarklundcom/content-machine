/**
 * PR-01 — THE GATE.
 *
 * Proves (or disproves) the one assumption the whole project rests on: that
 * YouTube caption text can be fetched from the Hostinger server IP, not just
 * from a laptop. YouTube blocks datacenter IP ranges aggressively, and every
 * cost figure in PLAN.md §1 assumes free caption text.
 *
 * Usage:
 *   npx tsx scripts/probe-captions.ts                        # default sample videos
 *   npx tsx scripts/probe-captions.ts <url-or-id> [more...]  # specific videos
 *   npx tsx scripts/probe-captions.ts --json                 # machine-readable
 *   npx tsx scripts/probe-captions.ts --full                 # print whole transcript
 *
 * Exit code 0 = at least one strategy returned real caption text for every
 * video that has captions. Exit code 1 = the gate failed; do not build PR-02.
 */

import { hostname } from "node:os";
import { parseVideoId } from "../src/lib/youtube/url";
import { STRATEGY_ORDER, tryStrategy } from "../src/lib/youtube/captions";
import {
  configuredProxyUrl,
  proxiedFetch,
  redactProxyUrl,
} from "../src/lib/youtube/captions/proxy";
import type { StrategyName, StrategyOutcome } from "../src/lib/youtube/captions/types";

/**
 * Three of the most-watched videos on the platform, all with caption tracks.
 * Using several removes the main ambiguity in a failed run: if one reports
 * "no captions" that is probably true of the video, but if all three do, we are
 * being blocked and YouTube is lying to us politely.
 */
const DEFAULT_VIDEOS = ["dQw4w9WgXcQ", "9bZkp7q19f0", "kJQP7kiw5Fk"];

const PREVIEW_CHARS = 400;

type VideoReport = {
  input: string;
  videoId: string | null;
  outcomes: StrategyOutcome[];
  working: StrategyName[];
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const full = argv.includes("--full");
  const inputs = argv.filter((a) => !a.startsWith("--"));
  const videos = inputs.length > 0 ? inputs : DEFAULT_VIDEOS;

  const env = await describeEnvironment();

  if (!asJson) {
    header("ENVIRONMENT");
    for (const [k, v] of Object.entries(env)) console.log(`  ${pad(k, 16)} ${v}`);
    console.log();
    console.log(`  Probing ${videos.length} video(s) against ${STRATEGY_ORDER.length} strategies.`);
    console.log("  Every strategy runs even after one succeeds — this is evidence gathering.");
    // Deliberately no adaptive health tracking here (tryStrategy does not
    // consult it): retiring a strategy after three failures is right for a
    // production run and wrong for the table this probe exists to print.
  }

  const reports: VideoReport[] = [];

  for (const input of videos) {
    const videoId = parseVideoId(input);
    if (!videoId) {
      reports.push({ input, videoId: null, outcomes: [], working: [] });
      if (!asJson) {
        header(`VIDEO ${input}`);
        console.log("  Could not parse a video ID from this input — skipped.");
      }
      continue;
    }

    if (!asJson) header(`VIDEO ${videoId}  (${input})`);

    const outcomes: StrategyOutcome[] = [];
    for (const strategy of STRATEGY_ORDER) {
      const outcome = await tryStrategy(strategy, videoId, ["en"], { timeoutMs: 20_000 });
      outcomes.push(outcome);
      if (!asJson) printOutcome(outcome);
    }

    const working = outcomes.filter((o) => o.ok).map((o) => o.strategy);
    reports.push({ input, videoId, outcomes, working });

    const firstOk = outcomes.find((o) => o.ok);
    if (!asJson && firstOk?.ok) {
      const { result } = firstOk;
      console.log();
      console.log(
        `  Transcript via ${result.strategy} — ${result.languageCode} (${result.kind}), ${result.wordCount} words`,
      );
      console.log("  " + "-".repeat(66));
      const text = full ? result.text : result.text.slice(0, PREVIEW_CHARS);
      for (const line of wrap(text, 66)) console.log(`  ${line}`);
      if (!full && result.text.length > PREVIEW_CHARS) console.log("  […] (pass --full for all)");
    }
  }

  const verdict = summarise(reports);

  if (asJson) {
    console.log(JSON.stringify({ env, reports, verdict }, null, 2));
  } else {
    header("VERDICT");
    console.log(`  ${verdict.passed ? "PASS — the gate is open." : "FAIL — the gate is shut."}`);
    console.log(`  ${verdict.detail}`);
    if (verdict.recommendedOrder.length > 0) {
      console.log();
      console.log("  Set this in the deployment env so the pipeline skips dead strategies:");
      console.log(`    CAPTION_STRATEGIES=${verdict.recommendedOrder.join(",")}`);
    }
    if (!verdict.passed) {
      console.log();
      console.log("  Per PLAN.md §5, do NOT start PR-02. Report the table above.");
      console.log("  Do NOT fall back to AI audio transcription — that is a ~20x cost");
      console.log("  change and needs a human decision (PLAN.md §6).");
      console.log();
      console.log("  If the refusals are blocks (403/429/bot wall) and this host is a");
      console.log("  datacenter IP, the cheapest next step is a residential proxy:");
      console.log("    CAPTION_PROXY_URL=http://user:pass@proxy.example:8080");
      console.log("  then re-run this probe. See docs/CAPTION-FETCH-RESILIENCE.md for");
      console.log("  all three options and the cost comparison.");
    }
  }

  process.exit(verdict.passed ? 0 : 1);
}

function summarise(reports: VideoReport[]): {
  passed: boolean;
  detail: string;
  recommendedOrder: StrategyName[];
} {
  const parsed = reports.filter((r) => r.videoId !== null);
  if (parsed.length === 0) {
    return { passed: false, detail: "No input parsed to a video ID.", recommendedOrder: [] };
  }

  // Rank strategies by how many videos they worked on, then by median speed —
  // a strategy that works everywhere is worth more than a fast flaky one.
  const stats = new Map<StrategyName, { wins: number; totalMs: number }>();
  for (const report of parsed) {
    for (const o of report.outcomes) {
      if (!o.ok) continue;
      const s = stats.get(o.strategy) ?? { wins: 0, totalMs: 0 };
      s.wins += 1;
      s.totalMs += o.ms;
      stats.set(o.strategy, s);
    }
  }

  const recommendedOrder = [...stats.entries()]
    .sort((a, b) => b[1].wins - a[1].wins || a[1].totalMs / a[1].wins - b[1].totalMs / b[1].wins)
    .map(([name]) => name);

  const withCaptions = parsed.filter(
    (r) => !r.outcomes.every((o) => !o.ok && o.reason === "no_captions"),
  );
  const succeeded = parsed.filter((r) => r.working.length > 0);
  const anyBlocked = parsed.some((r) => r.outcomes.some((o) => !o.ok && o.reason === "blocked"));

  if (succeeded.length === 0) {
    // A YouTube-side block costs a real round trip. Uniform sub-50ms refusals
    // mean something local — an egress proxy or firewall — answered instead, and
    // that is a completely different problem from the one this gate tests for.
    const failures = parsed.flatMap((r) => r.outcomes.filter((o) => !o.ok));
    // Two or more sub-50ms refusals cannot both be round trips to Google.
    // (Only the direct-fetch strategies are this fast; library-backed ones do
    // extra setup work, so a simple "every failure is fast" test never fires.)
    const looksLikeLocalProxy =
      failures.length > 0 &&
      failures.every((o) => o.reason === "blocked") &&
      failures.filter((o) => o.ms < 50).length >= 2;

    const detail = looksLikeLocalProxy
      ? "Every strategy was refused in under 50ms. That is too fast to be YouTube — " +
        "an egress proxy or firewall on THIS host is almost certainly blocking " +
        "youtube.com. Fix outbound access and re-run; this result says nothing " +
        "yet about the datacenter-IP question."
      : anyBlocked
        ? "Every strategy was refused. At least one refusal was an explicit block " +
          "(HTTP 403/429, bot wall, or LOGIN_REQUIRED) — this is the datacenter-IP " +
          "problem PLAN.md §0 warned about."
        : "Every strategy failed, but none reported an explicit block. Check outbound " +
          "network access from this host before concluding YouTube is the problem.";
    return { passed: false, detail, recommendedOrder };
  }

  if (succeeded.length < withCaptions.length) {
    return {
      passed: false,
      detail:
        `Only ${succeeded.length}/${withCaptions.length} caption-bearing videos returned text. ` +
        "Partial success on a datacenter IP usually means rate limiting — re-run to " +
        "see whether it is intermittent before treating the gate as open.",
      recommendedOrder,
    };
  }

  return {
    passed: true,
    detail:
      `${succeeded.length}/${parsed.length} videos returned caption text via ` +
      `${recommendedOrder.length} working strateg${recommendedOrder.length === 1 ? "y" : "ies"}. ` +
      (recommendedOrder.length === 1
        ? "Only one strategy works — there is no margin here, so expect to revisit this."
        : "Multiple strategies work, so one breaking is survivable."),
    recommendedOrder,
  };
}

function printOutcome(o: StrategyOutcome): void {
  const status = o.ok ? "ok  " : "FAIL";
  const detail = o.ok
    ? `${o.result.wordCount} words, ${o.result.segments.length} segments, ${o.result.languageCode}/${o.result.kind}`
    : `${o.reason} @${o.stage}: ${truncate(o.error, 90)}`;
  console.log(`  [${status}] ${pad(o.strategy, 18)} ${pad(`${o.ms}ms`, 8)} ${detail}`);
}

async function describeEnvironment(): Promise<Record<string, string>> {
  const proxy = configuredProxyUrl();
  return {
    host: hostname(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    time: new Date().toISOString(),
    // Redacted: residential proxies carry their password in the URL, and this
    // report gets pasted into chat threads and issues.
    proxy: proxy ? redactProxyUrl(proxy) : "none (direct)",
    "outbound IPv4": await lookupIp("https://api.ipify.org"),
    "outbound IPv6": await lookupIp("https://api64.ipify.org"),
  };
}

/**
 * The outbound IP is the single most important line of the report: it is what
 * makes a run self-evidencing rather than a claim.
 *
 * It goes through the proxy when one is configured, for exactly that reason —
 * reporting the function's own datacenter IP while the caption requests left
 * from somewhere else would make the whole table impossible to interpret.
 */
async function lookupIp(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await proxiedFetch(url, { signal: controller.signal });
    if (!res.ok) return `unavailable (HTTP ${res.status})`;
    return (await res.text()).trim() || "unavailable (empty)";
  } catch (err) {
    return `unavailable (${err instanceof Error ? err.message : String(err)})`;
  } finally {
    clearTimeout(timer);
  }
}

function header(title: string): void {
  console.log();
  console.log("=".repeat(72));
  console.log(`  ${title}`);
  console.log("=".repeat(72));
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && line.length + w.length + 1 > width) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

main().catch((err) => {
  console.error("\nProbe crashed:", err);
  process.exit(1);
});
