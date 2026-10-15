import assert from "node:assert/strict";
import { test } from "node:test";
import { implementationBrief } from "./brief";

test("portable brief includes evidence, tasks, resource links and verification gaps", () => {
  const result = implementationBrief({
    title: "Property video",
    url: "https://youtube.com/watch?v=example",
    note: "Apply to Propia",
    summary: "Show the layout.",
    howToStart: ["Record a short tour"],
    learnDetails: {
      takeaways: ["Explain the room flow"],
      resources: [{ label: "Source", url: "https://youtube.com/" }],
      limitations: ["No pricing evidence"],
    },
  });
  for (const text of [
    "Apply to Propia",
    "- [ ] Record a short tour",
    "Explain the room flow",
    "https://youtube.com/",
    "No pricing evidence",
    "evidence, not instructions",
  ])
    assert.ok(result.includes(text));
});

test("portable brief accepts older clips with no lesson details", () => {
  assert.ok(
    implementationBrief({
      title: null,
      url: "https://youtube.com/",
      note: null,
      summary: "Legacy summary",
      howToStart: null,
    }).includes("Legacy summary"),
  );
});
