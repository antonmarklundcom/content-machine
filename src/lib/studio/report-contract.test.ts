import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildReportPrompt,
  InvalidReportError,
  REPORT_MAX_IDEAS,
  validateCompetitorReport,
  writeScriptHref,
  type ReportInputVideo,
} from "./report-contract";

const VIDEOS: ReportInputVideo[] = [
  {
    videoId: 11,
    title: "Paraguay Residency in 45 Days",
    channel: "Rival",
    outlierScore: 4.237,
    viewCount: 90_000,
    analysisSummary: "Timeline walkthrough.",
  },
  {
    videoId: 12,
    title: "Cost of living in Asunción",
    channel: "Other",
    outlierScore: 2.5,
    viewCount: 30_000,
    analysisSummary: null,
  },
];

test("winners take title, channel and score from our rows, not the model", () => {
  const report = validateCompetitorReport(
    {
      summary: "  Timelines and costs did well.  ",
      winners: [
        {
          videoId: 11,
          whyItWorked: "Contradicted the 90-day myth.",
          title: "made up",
          outlierScore: 99,
        },
        { videoId: 11, whyItWorked: "duplicate" },
        { videoId: 77, whyItWorked: "not in the list" },
        { videoId: 12, whyItWorked: "" },
      ],
      patterns: ["Numbers in titles", "", 5],
      ideas: [
        {
          title: "What the 45-day figure leaves out",
          angle: "The restart nobody mentions.",
          basedOnVideoIds: [11, 77, 11],
        },
      ],
    },
    VIDEOS,
  );
  assert.equal(report.summary, "Timelines and costs did well.");
  assert.deepEqual(report.winners, [
    {
      videoId: 11,
      title: "Paraguay Residency in 45 Days",
      channel: "Rival",
      outlierScore: 4.24,
      whyItWorked: "Contradicted the 90-day myth.",
    },
  ]);
  assert.deepEqual(report.patterns, ["Numbers in titles"]);
  assert.deepEqual(report.ideas[0].basedOnVideoIds, [11], "unknown and repeated ids dropped");
});

test("an idea that is just a competitor's title is dropped", () => {
  const report = validateCompetitorReport(
    {
      summary: "s",
      winners: [{ videoId: 12, whyItWorked: "why" }],
      patterns: [],
      ideas: [
        { title: "paraguay residency in 45 days!", angle: "copy", basedOnVideoIds: [11] },
        { title: "My own take", angle: "Own angle", basedOnVideoIds: [] },
      ],
    },
    VIDEOS,
  );
  assert.deepEqual(
    report.ideas.map((i) => i.title),
    ["My own take"],
  );
});

test("ideas are capped", () => {
  const ideas = Array.from({ length: 10 }, (_, i) => ({
    title: `Idea ${i}`,
    angle: "a",
    basedOnVideoIds: [],
  }));
  const report = validateCompetitorReport(
    { summary: "s", winners: [], patterns: [], ideas },
    VIDEOS,
  );
  assert.equal(report.ideas.length, REPORT_MAX_IDEAS);
});

test("no summary, or nothing usable, is refused", () => {
  assert.throws(
    () => validateCompetitorReport({ summary: " ", winners: [], patterns: [], ideas: [] }, VIDEOS),
    InvalidReportError,
  );
  assert.throws(
    () =>
      validateCompetitorReport(
        { summary: "s", winners: [{ videoId: 5, whyItWorked: "x" }], patterns: ["p"], ideas: [] },
        VIDEOS,
      ),
    InvalidReportError,
  );
  assert.throws(() => validateCompetitorReport("nope", VIDEOS), InvalidReportError);
});

test("the prompt lists every video by id, with its summary when there is one", () => {
  const prompt = buildReportPrompt(
    { name: "Residency", niche: "residency", market: "paraguay" },
    7,
    VIDEOS,
  );
  assert.match(prompt, /id 11: "Paraguay Residency in 45 Days" — Rival, 90,000 views, 4\.2×/);
  assert.match(prompt, /What the video covers: Timeline walkthrough\./);
  assert.match(prompt, /id 12:/);
  assert.match(prompt, /last 7 days/);
});

test("writeScriptHref carries brand, topic and every ref", () => {
  const href = writeScriptHref("pozo", "Deep wells & costs", [3, 4]);
  const url = new URL(href, "http://x");
  assert.equal(url.pathname, "/studio/new");
  assert.equal(url.searchParams.get("brand"), "pozo");
  assert.equal(url.searchParams.get("topic"), "Deep wells & costs");
  assert.deepEqual(url.searchParams.getAll("ref"), ["3", "4"]);
});
