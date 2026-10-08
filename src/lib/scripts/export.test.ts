import assert from "node:assert/strict";
import { test } from "node:test";

import { shotList, shotListMarkdown, slugify, teleprompterMarkdown } from "./export";
import { sampleScriptBody } from "./fixture";
import { defaultScriptLanguage, needsVerification } from "./language";

const script = { id: 42, brandId: "residency-guide", status: "draft", body: sampleScriptBody() };

test("slugify is ASCII, hyphenated, and never empty", () => {
  assert.equal(slugify("Calendario — días de Migración!"), "calendario-dias-de-migracion");
  assert.equal(slugify("???"), "shot");
  assert.ok(slugify("a".repeat(100)).length <= 40);
});

test("the shot list numbers hook shots first, names files per script, and only motion shots get an .mp4", () => {
  const list = shotList(script);
  assert.equal(list.mediaDir, "media/42");
  assert.deepEqual(
    list.shots.map((s) => [s.number, s.section, s.files.image, s.files.video]),
    [
      [
        1,
        "Hook",
        "media/42/01-calendar-pages-flipping.png",
        "media/42/01-calendar-pages-flipping.mp4",
      ],
      [2, "The real timeline", "media/42/02-stopwatch-on-forms.png", null],
    ],
  );
  assert.equal(list.shots[0].spokenLine, "Everyone still says ninety days.");
  assert.equal(list.shots[1].aspectRatio, "9:16");
  assert.equal(list.thumbnails.length, 3);
  assert.equal(list.thumbnails[0].file, "media/42/thumb-1-calendar-90-crossed-out.png");

  const md = shotListMarkdown(list);
  assert.match(md, /## 01\. Calendar pages flipping/);
  assert.match(md, /\*\*Video prompt:\*\* Pages flip/);
  const json = md.slice(md.indexOf("```json") + 7, md.lastIndexOf("```"));
  assert.deepEqual(JSON.parse(json), list, "the fenced JSON is the same list");
});

test("the teleprompter puts spoken lines on their own lines and flags sources to verify where they are used", () => {
  const md = teleprompterMarkdown(script);
  assert.match(md, /^# Paraguay residency in 45 days/);
  assert.match(md, /\nEveryone still says ninety days\.\n\nThat changed\.\n/);
  assert.match(md, /> ⚠ VERIFY BEFORE RECORDING: s1\n\nIt takes about forty-five days\./);
  assert.match(md, /> ON SCREEN: ~45 days/);
  assert.match(
    md,
    /- \*\*s1\*\* .*\(https:\/\/example\.gov\.py\/migraciones\/plazos\) — ⚠ verify before recording/,
  );
});

test("residency and real estate default to English; Spanish brands to es-PY", () => {
  assert.equal(defaultScriptLanguage({ niche: "residency", language: "es" }), "en");
  assert.equal(defaultScriptLanguage({ niche: "real estate listings", language: "es" }), "en");
  assert.equal(defaultScriptLanguage({ niche: "accounting", language: "es" }), "es-PY");
  assert.equal(defaultScriptLanguage({ niche: "well drilling", language: "sv" }), "en");
});

test("legal, residency, tax and price claims need verifying even when the model said no", () => {
  assert.equal(needsVerification("The application fee is 1.2 million guaraníes.", false), true);
  assert.equal(needsVerification("La ley 6984 cambió los requisitos.", false), true);
  assert.equal(needsVerification("Processing takes 45 days.", false), true);
  assert.equal(needsVerification("Asunción is the capital.", false), false);
  assert.equal(needsVerification("Asunción is the capital.", true), true);
});
