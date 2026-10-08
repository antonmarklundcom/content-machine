import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";

import { db, schema } from "@/db";
import { glossaryToCsv } from "@/lib/glossary/csv";
import { setApprovedTermsSource } from "@/lib/glossary/prompt";
import {
  createGlossaryTerm,
  importGlossaryCsv,
  importSeed,
  listApprovedJoparaTerms,
  listGlossary,
  reviewGlossaryTerm,
  sendToPronunciations,
  toCsvRow,
  updateGlossaryTerm,
} from "@/lib/glossary/store";
import { loadStyleGuide } from "@/lib/scripts/language";
import { SAFE_JOPARA_WORDS } from "@/lib/glossary/warnings";

import { resetTables, teardown } from "./setup";

/** Build 4 · D: glossary storage, seed, CSV, review, pronunciations, prompt block. */

beforeEach(resetTables);
afterEach(() => setApprovedTermsSource(null));
after(teardown);

test("the seed imports every safe word as proposed, and is idempotent", async () => {
  const first = await importSeed();
  assert.equal(first.inserted, SAFE_JOPARA_WORDS.length);
  const rows = await listGlossary();
  assert.deepEqual(rows.map((r) => r.term).sort(), [...SAFE_JOPARA_WORDS].sort());
  assert.ok(rows.every((r) => r.reviewStatus === "proposed" && r.source === "jopara.md"));

  const id = rows.find((r) => r.term === "katu")!.id;
  await reviewGlossaryTerm(id, "approved", "Ña Rosa");
  const again = await importSeed();
  assert.equal(again.inserted, 0);
  assert.equal((await listGlossary()).length, SAFE_JOPARA_WORDS.length);
  assert.equal(
    (await listGlossary({ status: "approved" }))[0]?.reviewedBy,
    "Ña Rosa",
    "the seed never overwrites a review",
  );
});

test("CSV export → import round-trips and upserts on term + language", async () => {
  await importSeed();
  const csv = glossaryToCsv((await listGlossary()).map(toCsvRow));
  const res = await importGlossaryCsv(csv);
  assert.deepEqual(res, { rows: SAFE_JOPARA_WORDS.length, inserted: 0, updated: 13 });
  const added = await importGlossaryCsv("term,meaning_es,jopara_ok\nko'ãga,ahora,true\n");
  assert.equal(added.inserted, 1);
  assert.equal((await listGlossary({ q: "ahora" }))[0]?.term, "ko'ãga");
});

test("only approved + jopara_ok gn terms reach the jopara prompt", async () => {
  const yes = await createGlossaryTerm({ term: "mitã", meaningEs: "niño", joparaOk: true });
  const notOk = await createGlossaryTerm({ term: "kuña", meaningEs: "mujer", joparaOk: false });
  await createGlossaryTerm({ term: "porã", meaningEs: "lindo", joparaOk: true });
  await reviewGlossaryTerm(yes.id, "approved", "Ña Rosa");
  await reviewGlossaryTerm(notOk.id, "approved", "Ña Rosa");

  assert.deepEqual(
    (await listApprovedJoparaTerms()).map((t) => t.term),
    ["mitã"],
  );
  setApprovedTermsSource(listApprovedJoparaTerms);
  const guide = await loadStyleGuide("jopara");
  assert.match(guide, /PALABRAS GUARANÍES APROBADAS/);
  assert.match(guide, /- mitã — niño/);
  assert.doesNotMatch(guide, /kuña|porã —/);
  assert.doesNotMatch(await loadStyleGuide("es-PY"), /PALABRAS GUARANÍES APROBADAS/);
});

test("editing an approved term's meaning sends it back to proposed", async () => {
  const t = await createGlossaryTerm({ term: "mitã", meaningEs: "niño", joparaOk: true });
  await reviewGlossaryTerm(t.id, "approved", "Ña Rosa");
  await updateGlossaryTerm(t.id, { term: "mitã", meaningEs: "niña", joparaOk: true });
  const [row] = await listGlossary();
  assert.equal(row.reviewStatus, "proposed");
  assert.equal(row.reviewedBy, null);
});

test("send to pronunciations upserts gn + jopara rows with the term's review", async () => {
  const t = await createGlossaryTerm({ term: "Ypacaraí", sayAs: "Ipacaraí" });
  const none = await createGlossaryTerm({ term: "katu" });
  assert.equal(await sendToPronunciations(none.id), false);
  assert.equal(await sendToPronunciations(t.id), true);
  await reviewGlossaryTerm(t.id, "approved", "Ña Rosa");
  assert.equal(await sendToPronunciations(t.id), true);

  const rows = await db.select().from(schema.pronunciations);
  assert.deepEqual(rows.map((r) => r.language).sort(), ["gn", "jopara"]);
  for (const r of rows) {
    assert.equal(r.scope, "global");
    assert.equal(r.sayAs, "Ipacaraí");
    assert.equal(r.reviewStatus, "approved");
    assert.equal(r.reviewedBy, "Ña Rosa");
  }
});
