/**
 * The live smoke run (PLAN.md §1.17, §5.O5.3).
 *
 *   npm run smoke -- --dry-run                    # plan and estimates, spends nothing
 *   npm run smoke -- <brandId>                    # the real thing
 *   npm run smoke -- <brandId> --clip <youtubeUrl>
 *
 * This is the only thing in the repo that ever needs real credentials, and the
 * only thing that can answer the question the whole verification lane is built
 * around: are the reservations in `src/lib/ai.ts` and `src/lib/analysis` bigger
 * than what Google actually bills?
 *
 * A test double cannot answer that. It reports the usage it was told to report,
 * so a suite standing on it proves the arithmetic is consistent, never that the
 * inputs are right. `ESTIMATED_THINKING_TOKENS`, `MAX_GROUNDING_QUERIES` and
 * `PROMPT_OVERHEAD_TOKENS` are guesses until a real response has been measured
 * against them — which is what the "reservation vs actual" column below exists
 * to print.
 *
 * It writes real rows (ideas, an analysis, a clip) and spends real money, on
 * the order of ten cents. Point `DATABASE_URL` at a Neon *dev branch*, not at
 * production (§7.1).
 */

import type {
  GenerateContentParameters,
  GenerateContentResponse,
  GenerateContentResponseUsageMetadata,
} from "@google/genai";
import { desc, eq } from "drizzle-orm";

import { closeDb, db } from "../src/db";
import { analyses, brands, transcripts, videos, type Video } from "../src/db/schema";
import {
  estimateAdaptCostUsd,
  estimateContentPlanCostUsd,
  generateContentPlan,
  geminiClient,
  groundingQueryCount,
  messageCostUsd,
  readUsage,
} from "../src/lib/ai";
import { fakeGeminiEnabled } from "../src/lib/ai-fake";
import { analyzeVideo } from "../src/lib/analysis/run";
import { DEFAULT_MODEL, type TokenUsage } from "../src/lib/analysis/pricing";
import { processYouTubeClip, saveClip } from "../src/lib/clips/save";
import { promoteToIdea } from "../src/lib/promote";
import {
  estimateAnalysisCostUsd,
  formatUsd,
  monthToDateUsd,
  monthlyCapUsd,
  spendStatus,
} from "../src/lib/spend";

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------

type Args = { brandId: string | null; clipUrl: string | null; dryRun: boolean };

function parseArgs(argv: string[]): Args {
  const rest = [...argv];
  let clipUrl: string | null = null;
  let dryRun = false;
  const positional: string[] = [];

  while (rest.length) {
    const arg = rest.shift()!;
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--clip") clipUrl = rest.shift() ?? null;
    else if (arg.startsWith("--clip=")) clipUrl = arg.slice("--clip=".length);
    else if (arg.startsWith("--"))
      throw new Error(`Unknown option ${arg}. See the header of scripts/smoke.ts.`);
    else positional.push(arg);
  }

  return { brandId: positional[0] ?? null, clipUrl, dryRun };
}

// ---------------------------------------------------------------------------
// watching the wire
// ---------------------------------------------------------------------------

type Observed = {
  step: string;
  model: string;
  usage: GenerateContentResponseUsageMetadata | undefined;
  queries: number;
};

const observed: Observed[] = [];
let currentStep = "(setup)";

/**
 * Record every response the SDK returns, without changing what is sent.
 *
 * `Models.generateContent` and `generateContentStream` are instance properties,
 * so they can be wrapped from out here. That is the whole reason this script
 * needs no hook inside `ai.ts`: the seam in that file is for the fake, and
 * adding a second one for a diagnostic would put test scaffolding in the path
 * of every production call. What is measured here is exactly the traffic
 * production sends.
 */
function observeClient(): void {
  const client = geminiClient();
  const models = client.models as unknown as {
    generateContent: (p: GenerateContentParameters) => Promise<GenerateContentResponse>;
    generateContentStream: (
      p: GenerateContentParameters,
    ) => Promise<AsyncGenerator<GenerateContentResponse>>;
  };

  const realGenerate = models.generateContent.bind(models);
  models.generateContent = async (params) => {
    const step = currentStep;
    const response = await realGenerate(params);
    observed.push({
      step,
      model: String(params.model),
      usage: response.usageMetadata,
      queries: groundingQueryCount(response),
    });
    return response;
  };

  const realStream = models.generateContentStream.bind(models);
  models.generateContentStream = async (params) => {
    const step = currentStep;
    const stream = await realStream(params);
    const entry: Observed = { step, model: String(params.model), usage: undefined, queries: 0 };
    observed.push(entry);

    // Yielded straight through, so the caller sees the same chunks in the same
    // order — this only reads what goes past. Usage and grounding are
    // accumulated the way generateContentPlan accumulates them, so the figures
    // printed are the figures that were billed.
    const seen = new Set<string>();
    return (async function* () {
      for await (const chunk of stream) {
        if (chunk.usageMetadata) entry.usage = chunk.usageMetadata;
        for (const q of chunk.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [])
          seen.add(q);
        entry.queries = Math.max(entry.queries, seen.size);
        yield chunk;
      }
    })();
  };
}

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  currentStep = name;
  process.stdout.write(`\n── ${name}\n`);
  try {
    return await run();
  } finally {
    currentStep = "(between steps)";
  }
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

/** What each step reserved against the cap, filled in as the run goes. */
const reservations = new Map<string, number>();

function reserve(name: string, usd: number): number {
  reservations.set(name, usd);
  return usd;
}

function usd(value: number): string {
  return `$${value.toFixed(6)}`;
}

function reportCalls(): void {
  if (observed.length === 0) {
    console.log("\nNo model calls were made.");
    return;
  }

  console.log("\n=== What each call actually used ===\n");
  for (const call of observed) {
    const usage = call.usage;
    const tokens: TokenUsage = readUsage({ usageMetadata: usage } as GenerateContentResponse);
    const cost = messageCostUsd(tokens, call.queries, call.model);
    const held = reservations.get(call.step);

    console.log(`${call.step}  [${call.model}]`);
    if (!usage) {
      console.log(
        "  usageMetadata: ABSENT — the call billed its reservation instead. Investigate.",
      );
    } else {
      console.log(
        `  usageMetadata: prompt=${usage.promptTokenCount ?? 0}` +
          ` candidates=${usage.candidatesTokenCount ?? 0}` +
          ` thoughts=${usage.thoughtsTokenCount ?? 0}` +
          ` cached=${usage.cachedContentTokenCount ?? 0}` +
          ` total=${usage.totalTokenCount ?? 0}`,
      );
      console.log(
        `  billed as:     input=${tokens.inputTokens} output=${tokens.outputTokens} cacheRead=${tokens.cacheReadTokens}`,
      );
    }
    console.log(`  webSearchQueries: ${call.queries}`);
    console.log(`  cost:          ${usd(cost)}`);
    if (held !== undefined) {
      const headroom = held - cost;
      const verdict =
        headroom >= 0
          ? `OK — ${usd(headroom)} of headroom`
          : `TOO LOW by ${usd(-headroom)} — raise the estimate constants`;
      console.log(`  reservation:   ${usd(held)}  ${verdict}`);
    }
    console.log("");
  }
}

/**
 * The three constants a live run exists to re-baseline, checked against what
 * came back (§5.O5.3).
 *
 * Only the grounded ideation call can move them, so this reads that call. A
 * reservation that came back too low is the one result of this script that
 * requires a code change, so it is printed last and named plainly.
 */
function reportBaseline(): void {
  const ideation = observed.find((call) => call.queries > 0) ?? observed[0];
  if (!ideation?.usage) return;

  console.log("=== Re-baselining src/lib/ai.ts ===\n");
  console.log(`  MAX_GROUNDING_QUERIES      reserved 8, observed ${ideation.queries}`);
  console.log(
    `  ESTIMATED_THINKING_TOKENS  reserved 8000, observed ${ideation.usage.thoughtsTokenCount ?? 0}`,
  );
  console.log(
    `  PROMPT_OVERHEAD_TOKENS     reserved 4000, observed ${ideation.usage.promptTokenCount ?? 0}` +
      "  (a grounded call's prompt includes Search results, which Google does not charge for)",
  );
  console.log(
    "\n  Raise a constant only if the observed figure exceeds it — these are ceilings for a\n" +
      "  reservation, not forecasts, and lowering one makes the cap trip late.\n",
  );
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // §1.17: this script is the one that talks to Google. Answering from canned
  // data here would produce a re-baselining report made of numbers this repo
  // wrote itself — worse than no report, because it looks like evidence.
  if (fakeGeminiEnabled()) {
    fail(
      "Refusing to run against the Gemini test double.\n" +
        "  GEMINI_FAKE is set (or NODE_ENV=test with no GEMINI_API_KEY). This script exists to\n" +
        "  measure what Google really bills; canned usage figures cannot re-baseline anything.\n" +
        "  Unset GEMINI_FAKE and set a real GEMINI_API_KEY.",
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("DATABASE_URL is not set. Point it at a Neon dev branch (PLAN.md §7.1).");
  const host = new URL(databaseUrl).host;

  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  if (!hasKey && !args.dryRun) {
    fail("GEMINI_API_KEY is not set. A live smoke run needs a key on a billed project.");
  }

  console.log("=== content-engine smoke ===\n");
  console.log(
    `  mode:        ${args.dryRun ? "DRY RUN — nothing is sent, nothing is spent" : "LIVE — this spends real money"}`,
  );
  console.log(`  database:    ${host}`);
  console.log(`  gemini key:  ${hasKey ? "present" : "ABSENT"}`);
  console.log(
    `  model:       ${process.env.GEMINI_MODEL ?? "gemini-3.7-flash"} (ideation), ${DEFAULT_MODEL} (analysis)`,
  );
  console.log(`  monthly cap: ${formatUsd(monthlyCapUsd())}`);

  const brand = await resolveBrand(args.brandId);
  const clipVideo = args.clipUrl ? null : await mostRecentTranscribedVideo();

  const before = await spendStatus();
  console.log(
    `\n  spend before: month-to-date ${formatUsd(before.monthToDateUsd)}, ` +
      `committed ${formatUsd(before.committedUsd)}, remaining ${formatUsd(before.remainingUsd)}`,
  );

  // The plan, with the reservation each step will hold. Printed either way:
  // a dry run is this list and nothing else.
  const analysisWords = clipVideo ? await wordCountFor(clipVideo.id) : 5_000;
  console.log("\n=== Plan ===\n");
  console.log(
    `  1. generate        brand "${brand?.id ?? "<none>"}" — grounded ideation, reserves ${usd(estimateContentPlanCostUsd())}`,
  );
  console.log(
    `  2. clip save       ${args.clipUrl ?? (clipVideo ? `(no --clip; skipped, ${clipVideo.title} already ingested)` : "(no --clip and no ingested video; skipped)")}`,
  );
  console.log(
    `  3. analysis        one interactive re-analysis, reserves ~${usd(estimateAnalysisCostUsd(analysisWords, DEFAULT_MODEL))} at ${analysisWords} words`,
  );
  console.log(`  4. promote-adapt   one cheap rewrite, reserves ${usd(estimateAdaptCostUsd())}`);

  if (args.dryRun) {
    console.log(
      "\nDry run — nothing was sent and nothing was spent.\n" +
        "Re-run without --dry-run (and with a brand id) to measure the real figures.\n",
    );
    return;
  }

  if (!brand) fail("A live run needs a brand id: npm run smoke -- <brandId>");
  observeClient();

  // 1. Generate. The expensive one, and the only grounded one.
  await step("1. generate", async () => {
    reserve("1. generate", estimateContentPlanCostUsd());
    const allBrands = await db.select().from(brands);
    const result = await generateContentPlan(brand, allBrands, []);
    console.log(
      `   ${result.ideas.length} ideas, ${result.researchNotes.length} research notes, ${usd(result.costUsd)}`,
    );
    return result;
  });

  // 2. Clip save — the capture path, ingest and all. Skipped rather than faked
  // when there is nothing to save; the other three steps still measure.
  let video: Video | null = clipVideo;
  if (args.clipUrl) {
    video = await step("2. clip save", async () => {
      const saved = await saveClip({ url: args.clipUrl!, note: "smoke run" });
      if (!saved.ok) {
        console.log(`   refused: ${saved.error}`);
        return null;
      }
      const processed = await processYouTubeClip(saved.clip);
      console.log(
        `   clip ${processed.id}: ${processed.status}${processed.error ? ` — ${processed.error}` : ""}`,
      );
      if (!processed.videoId) return null;
      const [row] = await db.select().from(videos).where(eq(videos.id, processed.videoId));
      return row ?? null;
    });
  } else {
    console.log(
      "\n── 2. clip save  (skipped — pass --clip <youtubeUrl> to exercise the capture path)",
    );
  }

  // 3. One interactive analysis, forced so it is a measured call rather than a
  // no-op on a video the clip step just analysed.
  const analysis = video
    ? await step("3. analysis", async () => {
        reserve(
          "3. analysis",
          estimateAnalysisCostUsd(await wordCountFor(video!.id), DEFAULT_MODEL),
        );
        const result = await analyzeVideo(video!, { force: true });
        console.log(`   ${result.status}${"costUsd" in result ? ` — ${usd(result.costUsd)}` : ""}`);
        return result.status === "ok" ? result.analysis : null;
      })
    : (console.log("\n── 3. analysis  (skipped — no video with a transcript)"), null);

  // 4. Promote with adapt — the cheap end of the range, and the only paid call
  // in the app with no Search grounding at all.
  const promotable = analysis ?? (await mostRecentOkAnalysis());
  if (promotable?.ideas?.length) {
    await step("4. promote-adapt", async () => {
      reserve("4. promote-adapt", estimateAdaptCostUsd());
      const result = await promoteToIdea({
        source: { kind: "analysis-idea", analysisId: promotable.id, ideaIndex: 0 },
        brandId: brand.id,
        format: "carousel",
        platform: brand.platforms[0] ?? "instagram",
        adapt: true,
      });
      console.log(
        result.ok
          ? `   idea ${result.idea.id}, ${usd(result.costUsd)}`
          : `   failed: ${result.error}`,
      );
    });
  } else {
    console.log(
      "\n── 4. promote-adapt  (skipped — no successful analysis with ideas to promote from)",
    );
  }

  const after = await spendStatus();
  console.log("\n=== Spend ===\n");
  console.log(`  month-to-date before: ${formatUsd(before.monthToDateUsd)}`);
  console.log(`  month-to-date after:  ${formatUsd(after.monthToDateUsd)}`);
  console.log(
    `  this run:             ${formatUsd((await monthToDateUsd()) - before.monthToDateUsd)}`,
  );
  console.log(
    `  reservation held now: ${usd(after.projectedUsd - after.monthToDateUsd - after.committedUsd)} (0 means every reservation was released)`,
  );
  console.log(
    `  cap:                  ${formatUsd(after.capUsd)}, remaining ${formatUsd(after.remainingUsd)}`,
  );

  reportCalls();
  reportBaseline();
}

// ---------------------------------------------------------------------------
// lookups
// ---------------------------------------------------------------------------

async function resolveBrand(brandId: string | null) {
  if (!brandId) return null;
  const [row] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
  if (!row) {
    const known = (await db.select({ id: brands.id }).from(brands)).map((b) => b.id);
    fail(`No brand "${brandId}". Known: ${known.join(", ") || "(none — run npm run db:seed)"}`);
  }
  return row;
}

async function mostRecentTranscribedVideo(): Promise<Video | null> {
  const [row] = await db
    .select()
    .from(videos)
    .innerJoin(transcripts, eq(transcripts.videoId, videos.id))
    .orderBy(desc(videos.id))
    .limit(1);
  return row?.videos ?? null;
}

async function wordCountFor(videoId: number): Promise<number> {
  const [row] = await db
    .select({ wordCount: transcripts.wordCount })
    .from(transcripts)
    .where(eq(transcripts.videoId, videoId))
    .limit(1);
  return row?.wordCount ?? 5_000;
}

async function mostRecentOkAnalysis() {
  const [row] = await db
    .select()
    .from(analyses)
    .where(eq(analyses.status, "ok"))
    .orderBy(desc(analyses.id))
    .limit(1);
  return row ?? null;
}

function fail(message: string): never {
  console.error(`\nsmoke: ${message}\n`);
  process.exit(1);
}

main()
  .catch((error) => {
    console.error("\nsmoke failed:", error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
