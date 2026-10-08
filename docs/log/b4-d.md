# b4-d — Guaraní glossary + language rules

## Built
- `/glossary` (owner-only): search, filters (status, register, jopara_ok), add/edit, approve/reject with reviewer name + date, delete, send to pronunciations.
- CSV import/export (`src/lib/glossary/csv.ts`, RFC 4180, UTF-8, BOM-tolerant); export at `GET /glossary/export`.
- Seed `content/glossary/gn-seed.csv` (the 13 jopara.md safe words, `proposed`, source `jopara.md`) + "Import seed" (insert-only, idempotent).
- "Send to pronunciations": upserts `global` rows for `gn` and `jopara`, review copied from the term.
- Prompt rules (`src/lib/glossary/prompt.ts`): Jopará guides get "PALABRAS GUARANÍES APROBADAS" (approved + jopara_ok, 60 s cache, empty-glossary text); hooked in `loadStyleGuide` (scripts) and `loadPostStyleGuide` (posts).
- `gn` post generation throws `GuaraniGenerationRefusedError` (status 400); scripts already have no `gn` language.
- `findUnapprovedGuarani()` + `GlossaryWarnings` server component.
- `content/style/gn.md`; jopara.md gained a short "Glosario aprobado" section.
- Tests: csv/warnings/prompt unit tests; `tests/integration/b4-d-glossary.test.ts`.

## Decisions
- `src/lib/ai.ts` is untouched: the block is appended where the guide is loaded, so ai.ts prompt wording is unchanged.
- Editing term, meaning, example or jopara_ok resets an approved term to `proposed`.
- Seed never overwrites an existing term; CSV import does (the CSV is a reviewer's edit).
- Under `node --test` (NODE_TEST_CONTEXT) or without DATABASE_URL the default term source is empty; tests inject one via `setApprovedTermsSource`.
- Warnings run for `jopara` and `es*`; `gn` shows a "needs a native speaker" notice; other languages render nothing.

## Known issues
- `GuaraniGenerationRefusedError` is not mapped by `src/lib/posts/http.ts` / `posts.actions.ts` yet, so a `gn` post currently surfaces as a generic error (see Link pass).
- Common-word list in `warnings.ts` is a hand-picked starter set; a native speaker should extend it.

## Link pass
- Nav: add `/glossary` (owner) to `Header.tsx`; optional home card.
- Mount `<GlossaryWarnings text={…} language={…} />` (server component, `src/components/GlossaryWarnings.tsx`) in the script studio under the script body (language = script language) and in the post editor page (caption text, account effective language).
- Map `GuaraniGenerationRefusedError` (from `@/lib/glossary/prompt`, has `.status = 400`) to a 400 in `src/lib/posts/http.ts` and `src/lib/posts.actions.ts`, or hide `gn` from account language pickers.
- No package.json scripts needed. Dict `glossary.ts` is already wired in `dictionary.ts`.

## Verification
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:db` (DB `content_engine_d`) all pass.
