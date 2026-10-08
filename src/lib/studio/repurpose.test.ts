import assert from "node:assert/strict";
import { test } from "node:test";

import { sampleScriptBody } from "@/lib/scripts/fixture";
import { validateScriptBody } from "@/lib/scripts/contract";
import { assembleShortBody, composeProse, type RawShort } from "./repurpose";

function rawShort(overrides: Partial<RawShort> = {}): RawShort {
  return {
    titleOptions: [
      { title: "45 days, not 90", angle: "Contradiction." },
      { title: "The new residency timeline", angle: "Plain." },
      { title: "Stop waiting 90 days", angle: "Mistake." },
    ],
    thumbnailConcepts: [
      { description: "Calendar", textOverlay: "45", imagePrompt: "Vertical calendar close-up" },
      { description: "Folder", textOverlay: "", imagePrompt: "Vertical folder on desk" },
      { description: "Passport", textOverlay: "NEW", imagePrompt: "Vertical passport" },
    ],
    hookLines: ["Ninety days? Not anymore."],
    hookOnScreenText: ["90 → 45"],
    heading: "The timeline",
    spokenLines: ["It takes about forty-five days.", "If the file is complete."],
    talkingPoints: ["Point at the calendar"],
    onScreenText: ["~45 days"],
    broll: [
      {
        spokenLine: "It takes about forty-five days.",
        description: "Stopwatch",
        imagePrompt: "Stopwatch",
        videoPrompt: "",
      },
    ],
    sourceIds: ["s1", "s9"],
    ctaLines: ["Full video on the channel."],
    ...overrides,
  };
}

test("a short becomes a valid 1-minute contract body with vertical shots and only the parent's cited sources", () => {
  const parent = sampleScriptBody();
  const body = assembleShortBody(rawShort(), parent);
  assert.deepEqual(validateScriptBody(body), { ok: true });
  assert.equal(body.targetMinutes, 1);
  assert.equal(body.language, parent.language);
  assert.equal(body.chosenTitle, "45 days, not 90");
  assert.equal(body.sections[0]!.broll[0]!.aspectRatio, "9:16");
  assert.equal(body.sections[0]!.broll[0]!.videoPrompt, null, "an empty video prompt is a still");
  assert.deepEqual(body.sections[0]!.sourceIds, ["s1"], "an unknown source id is dropped");
  assert.deepEqual(body.sources, parent.sources);
});

test("a short with no spoken body fails the contract instead of being saved", () => {
  const body = assembleShortBody(rawShort({ spokenLines: [" "] }), sampleScriptBody());
  const verdict = validateScriptBody(body);
  assert.equal(verdict.ok, false);
});

test("a blog post gets the script's sources as links; a newsletter does not", () => {
  const b = sampleScriptBody();
  assert.equal(
    composeProse("blog", "# Title\n\nText.", b),
    "# Title\n\nText.\n\n## Sources\n\n- [Migraciones](https://example.gov.py/migraciones/plazos)",
  );
  assert.equal(composeProse("newsletter", " Short. ", b), "Short.");
});
