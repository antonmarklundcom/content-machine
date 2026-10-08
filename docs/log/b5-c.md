# b5-c — Training dataset export

## Built

- `src/lib/voice/dataset/select.ts`: pure selection (done + manual, approved by default, one take per owner/scene/speaker — selected else newest, 1–15 s filter with reported exclusions) and the consent gate.
- `normalize.ts`: Spanish number words (`spellNumberEs`, `normalizeText` for es/es-PY/jopara only).
- `csv.ts`: LJSpeech `metadata.csv` (NFC, pipes → ` / `, line breaks collapsed).
- `query.ts`: candidates with WAV master paths; `datasetOverview()` per profile × language.
- `export.ts`: `exportDataset()` (ffmpeg trim + loudnorm → 22,050 Hz mono s16, metadata.csv, dataset.json, README.md; temp folder + rename; dry run), `listExports()`.
- `scripts/voice-dataset.ts` CLI (`--profile --lang --include-unreviewed --include-tts --min --max --dry-run`).
- `/voice/dataset` page + `DatasetExportButton` + `exportDatasetAction` (owner only, PC only via the voice layout and `assertOnPc`).
- Dict `dataset.*` (en + sv); `docs/DATASET.md`.
- Tests: `src/lib/voice/dataset/dataset-pure.test.ts` (8), `tests/integration/b5-c-dataset.test.ts` (2, ffprobe checks).

## Decisions

- Clip ids are `take<narrationId>`; folder timestamp is local time.
- A selected take that is not eligible (rejected/unreviewed) falls back to the newest eligible take in its slot.
- Duration filter uses the stored take duration; `dataset.json` records the measured post-trim duration.
- `--include-tts` exists (off) and is documented as not for training.
- A `|` in text becomes ` / ` rather than being escaped (LJSpeech has no escape).
- Existing folder name → `-2`, `-3` suffix; temp folders start with `.` and are hidden from the list.
- Export with zero clips throws (dry run still reports).

## Known issues

- Single-pass loudnorm on very short clips is approximate.
- The overview runs one query per profile × language (fine for a handful of profiles).
- Training outline in docs/DATASET.md is untested guidance.
- `VoiceSubnav` has no Dataset link (not owned).

## Link pass

- package.json: `"voice:dataset": "tsx --conditions=react-server scripts/voice-dataset.ts"`
- `src/components/VoiceSubnav.tsx`: add `{ href: "/voice/dataset", key: "dataset.title" }` (or nav key).
- `docs/VOICE.md`: link to docs/DATASET.md.

## Verification

- typecheck pass · lint pass · `npm test` 608/608 · `npm run test:db` 340/342: the 2 failures are in `social-schema.test.ts` (migrations on an empty database), which passes 3/3 run alone. Probably a temp database shared with the parallel phases on one Postgres. Local DB `content_engine_b5c`, ffmpeg present.
