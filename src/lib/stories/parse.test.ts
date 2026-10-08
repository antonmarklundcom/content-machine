import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  artPathFromManifest,
  jsonFile,
  normalizeLang,
  parseBook,
  parseTsv,
  sceneKey,
  tsvFile,
} from "./parse";
import type { BookFiles } from "./types";

const FIXTURE = path.join(process.cwd(), "tests/fixtures/cuentos/books/tito-salto-chiquito");
const read = (rel: string) => readFileSync(path.join(FIXTURE, rel), "utf8");

/** The fixture book as `loadBook` would hand it over, with the art files present (except S04's). */
function fixtureBook(extraFiles: string[] = []): BookFiles {
  return {
    slug: "tito-salto-chiquito",
    story: JSON.parse(read("story.json")),
    artManifest: JSON.parse(read("art/manifest.json")),
    languageFiles: [jsonFile("languages/gn.json", read("languages/gn.json"))],
    audioFiles: [jsonFile("audio/narration.es.json", read("audio/narration.es.json"))],
    files: [
      "story.json",
      "art/manifest.json",
      "art/S01-a.png",
      "art/S01-b.png",
      "art/S02.png",
      "art/S03-old.png",
      "art/S03-new.png",
      "languages/gn.json",
      "audio/narration.es.json",
      "HANDOFF.md",
      ...extraFiles,
    ],
  };
}

test("the fixture book: title, series, age band, languages, scene order", () => {
  const story = parseBook(fixtureBook());
  assert.equal(story.title, "Tito y el salto chiquito");
  assert.equal(story.series, "Tito");
  assert.equal(story.ageBand, "3-5");
  assert.deepEqual(story.languages, ["es", "gn", "en"]);
  assert.deepEqual(
    story.scenes.map((s) => [s.sceneRef, s.position, s.kind]),
    [
      ["S01", 1, "page"],
      ["S02", 2, "page"],
      ["S03", 3, "page"],
      ["S04", 4, "page"],
    ],
  );
});

test("text is verbatim, null stays null, a string status applies to every language", () => {
  const [s1, s2, s3] = parseBook(fixtureBook()).scenes;
  assert.equal(
    s2.text.es,
    "—¿Vos podés saltar tan alto? —preguntó Tito. La garza se rió despacito.",
  );
  assert.equal(s2.text.gn, null, "missing Guaraní is never invented");
  assert.deepEqual(s3.textStatus, { es: "pending-review", gn: "pending-review" });
  assert.equal(s1.textStatus.en, "draft");
  assert.equal(s1.alt, "Un sapito chiquito junto al arroyo.");
  assert.equal(s1.artBrief, "A tiny toad by a stream at dawn.");
});

test("languages/gn.json fills a null gn text with its own status, never overriding story.json", () => {
  const scenes = parseBook(fixtureBook()).scenes;
  assert.equal(scenes[0].text.gn, "Tito ha'e peteĩ kururu'i michĩ.");
  assert.equal(scenes[0].textStatus.gn, "pending-review");
  assert.equal(
    scenes[3].text.gn,
    "[??] Ha'e peteĩ jopo michĩ.",
    "kept verbatim; the rules refuse it",
  );
  assert.equal(scenes[1].text.gn, null);
});

test("audio script lines split a scene by speaker only when they say exactly the text", () => {
  const story = parseBook(fixtureBook());
  assert.deepEqual(story.scenes[1].lines.es, [
    { speaker: "tito", text: "—¿Vos podés saltar tan alto?" },
    { speaker: null, text: "—preguntó Tito. La garza se rió despacito." },
  ]);
  const book = fixtureBook();
  book.audioFiles = [
    jsonFile(
      "audio/es/script.json",
      JSON.stringify([{ scene: "S01", speaker: "narrator", text: "Tito era un sapo grande." }]),
    ),
  ];
  const changed = parseBook(book);
  assert.equal(changed.scenes[0].lines.es, undefined);
  assert.ok(
    changed.report.warnings.some((w) => w.includes("does not say exactly the approved text")),
  );
});

test("art: selected beats newer, rejected never wins, newest wins otherwise, missing file falls back", () => {
  const story = parseBook(fixtureBook());
  const art = Object.fromEntries(story.scenes.map((s) => [s.sceneRef, s.artPath]));
  assert.equal(art.S01, "books/tito-salto-chiquito/art/S01-a.png");
  assert.equal(art.S02, "books/tito-salto-chiquito/art/S02.png");
  assert.equal(art.S03, "books/tito-salto-chiquito/art/S03-new.png");
  assert.equal(art.S04, null, "S04's art is not on disk");
  assert.ok(story.report.warnings.some((w) => w.startsWith("S04") && w.includes("not on disk")));
  assert.ok(
    story.report.warnings.some((w) => w.includes('"cover"')),
    "unused manifest entries are reported",
  );
});

test("art paths: absolute Windows paths under the book, book-relative, and climbing paths", () => {
  assert.equal(
    artPathFromManifest("C:\\dev\\cuentos\\books\\tito\\art\\S01.png", "tito"),
    "books/tito/art/S01.png",
  );
  assert.equal(artPathFromManifest("art/S01.png", "tito"), "books/tito/art/S01.png");
  assert.equal(artPathFromManifest("./art/S01.png", "tito"), "books/tito/art/S01.png");
  assert.equal(artPathFromManifest("../other/art.png", "tito"), null);
  assert.equal(artPathFromManifest("D:\\elsewhere\\x.png", "tito"), null);
});

test("unknown files and keys are reported, never dropped silently", () => {
  const book = fixtureBook([
    "notes.txt",
    "languages/gn-notes.md",
    "audio/manifest.json",
    "audio/es/S01.wav",
  ]);
  book.audioFiles.push(
    jsonFile("audio/manifest.json", JSON.stringify([{ scene: "S01", file: "S01.wav" }])),
  );
  book.languageFiles.push(jsonFile("languages/broken.json", "{ not json"));
  (book.story as Record<string, unknown>).mystery = 1;
  const story = parseBook(book);
  assert.deepEqual(story.report.unknownFiles, [
    "audio/manifest.json",
    "languages/broken.json",
    "languages/gn-notes.md",
    "notes.txt",
  ]);
  assert.ok(story.report.warnings.some((w) => w.includes("mystery")));
  assert.ok(story.report.warnings.some((w) => w.includes("audio file(s)")));
  assert.ok(story.report.warnings.some((w) => w.includes("languages/broken.json")));
});

test("other shapes: scenes array, plain-string text, per-language object entries, keyed language file", () => {
  const story = parseBook({
    slug: "meli",
    story: {
      title: { es: "Meli del mango" },
      series: { name: "Meli del mango" },
      age: { min: 6, max: 9 },
      scenes: [
        { id: "S01", text: "Meli subió al mango.", status: "final" },
        { text: { es: { text: "Bajó despacito.", status: "locked" }, "es-PY": null } },
        { id: "S01", text: { es: "duplicate" } },
      ],
    },
    artManifest: { S01: [{ path: "art/m1.jpg" }] },
    languageFiles: [
      jsonFile(
        "languages/jopara/text.json",
        JSON.stringify({ S01: { text: "Meli ojupi mango-pe.", status: "approved" } }),
      ),
    ],
    audioFiles: [],
    files: ["story.json", "art/m1.jpg", "languages/jopara/text.json"],
  });
  assert.equal(story.title, "Meli del mango");
  assert.equal(story.series, "Meli del mango");
  assert.equal(story.ageBand, "6-9");
  assert.equal(story.scenes.length, 2);
  assert.equal(story.scenes[0].text.es, "Meli subió al mango.");
  assert.equal(story.scenes[0].textStatus.es, "final");
  assert.equal(story.scenes[1].sceneRef, "S02", "a page without an id gets one, with a warning");
  assert.equal(story.scenes[1].textStatus.es, "locked");
  assert.equal(
    story.scenes[1].text.es,
    "Bajó despacito.",
    "a null alias key does not erase the text",
  );
  assert.equal(story.scenes[0].text.jopara, "Meli ojupi mango-pe.");
  assert.equal(story.scenes[0].textStatus.jopara, "approved");
  assert.equal(story.scenes[0].artPath, "books/meli/art/m1.jpg");
  assert.ok(story.report.warnings.some((w) => w.includes("plain string")));
  assert.ok(story.report.warnings.some((w) => w.includes("Duplicate scene id")));
  assert.deepEqual(story.languages, ["es", "jopara"]);
});

test("a story.json that is not an object still parses to an empty, reported story", () => {
  const story = parseBook({ slug: "x", story: [], languageFiles: [], audioFiles: [], files: [] });
  assert.equal(story.title, "x");
  assert.equal(story.scenes.length, 0);
  assert.ok(story.report.warnings.length >= 2);
});

test("normalizeLang", () => {
  assert.equal(normalizeLang("es-PY"), "es");
  assert.equal(normalizeLang("Jopará"), "jopara");
  assert.equal(normalizeLang("Guaraní"), "gn");
  assert.equal(normalizeLang("grn"), "gn");
  assert.equal(normalizeLang("notes"), null);
});

// --- shapes from the real cuentos repo (checked 2026-10-07) -----------------

test("scene keys: S01, S001, s1 and a page number are one scene", () => {
  assert.equal(sceneKey("S01"), sceneKey("S001"));
  assert.equal(sceneKey("s1"), "S1");
  assert.equal(sceneKey("1"), "S1");
  assert.equal(sceneKey("COVER"), "COVER");
  assert.equal(sceneKey("S06-R1"), "S06-R1");
});

test("TSV narration scripts: quoted multi-line text, approval column", () => {
  const tsv =
    "sceneId\tpage\ttext\tapproval\texpectedFile\n" +
    'S001\t1\t"Peteĩ círculo tuicháva.\nAmaʼẽ hesekuéra nendive."\thuman-review-pending\tgn/S001.mp3\n' +
    'S002\t2\t"Dice ""hola"" bajito."\thuman-review-pending\tgn/S002.mp3\n';
  const rows = parseTsv(tsv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, "Peteĩ círculo tuicháva.\nAmaʼẽ hesekuéra nendive.");
  assert.equal(rows[1].text, 'Dice "hola" bajito.');
  assert.equal(rows[0].approval, "human-review-pending");
});

test("real repo: page art, S001 ids vs S01 drafts, gn draft rows and TSV fill Guaraní as unreviewed", () => {
  const story = {
    title: "Grande, chiquito",
    age: "7–10 · libro por capítulos para primeros lectores y lectura compartida",
    status: "draft-for-author",
    pages: [
      {
        page: "1",
        art: "art/originals/01.png",
        text: { es: "Un círculo grande.", gn: null, en: null },
        textStatus: { es: "draft-for-author", gn: "not-translated-needs-native-review" },
        artBrief: "A big circle.",
        alt: "Un círculo grande.",
      },
      {
        id: "S002",
        page: 2,
        art: "art/originals/02.png",
        text: { es: "Una hoja chiquita.", gn: null },
        artBrief: "A small leaf.",
        alt: "Una hoja chiquita.",
      },
    ],
  };
  const draft = {
    locale: "gn",
    status: "unreviewed-ai-draft",
    pages: [{ id: "S001", page: 1, es: "Un círculo grande.", gn: "Peteĩ círculo tuicháva." }],
  };
  const tsv =
    "sceneId\tpage\ttext\tapproval\texpectedFile\n" +
    "S002\t2\tPeteĩ hoja michĩva.\thuman-review-pending\tgn/S002.mp3\n";
  const parsed = parseBook({
    slug: "grande-chiquito",
    story,
    artManifest: [{ index: 1, file: "01.png", selected: true }],
    languageFiles: [
      jsonFile("languages/gn.draft.json", JSON.stringify(draft)),
      tsvFile("audio/script.gn.tsv", tsv),
    ],
    audioFiles: [
      jsonFile(
        "audio/manifest.json",
        JSON.stringify({ schemaVersion: 1, tracks: [{ locale: "es", clips: [] }] }),
      ),
    ],
    files: [
      "story.json",
      "art/manifest.json",
      "art/originals/01.png",
      "art/originals/02.png",
      "languages/gn.draft.json",
      "audio/script.gn.tsv",
      "audio/manifest.json",
    ],
  });
  assert.equal(parsed.ageBand, story.age);
  const [s1, s2] = parsed.scenes;
  assert.equal(s1.sceneRef, "S01");
  assert.equal(s1.artPath, "books/grande-chiquito/art/originals/01.png");
  assert.equal(s2.artPath, "books/grande-chiquito/art/originals/02.png");
  // Guaraní from the draft (S001 matched S01) and from the TSV, never approved.
  assert.equal(s1.text.gn, "Peteĩ círculo tuicháva.");
  assert.equal(s1.textStatus.gn, "unreviewed-ai-draft");
  assert.equal(s2.text.gn, "Peteĩ hoja michĩva.");
  assert.equal(s2.textStatus.gn, "human-review-pending");
  // Spanish untouched.
  assert.equal(s1.text.es, "Un círculo grande.");
  assert.equal(s1.textStatus.es, "draft-for-author");
  assert.ok(!parsed.report.unknownFiles.includes("audio/manifest.json"));
  assert.ok(!parsed.report.unknownFiles.includes("audio/script.gn.tsv"));
  assert.ok(!parsed.report.warnings.some((w) => /Page keys not read/.test(w)));
});
