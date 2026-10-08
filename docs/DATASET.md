# Voice training datasets

Build 5 phase C. Exports a narrator's approved recordings as a training dataset so a
voice (including Guaraní, which no TTS service speaks) can be trained later.
**Nothing is uploaded** (PLAN-build5 §1.6): the export is a folder on the media drive.

## Exporting

- Page: `/voice/dataset` (owner, PC only) — per voice profile × language: approved clips,
  hours, unreviewed count, an Export button, recent exports.
- CLI: `npm run voice:dataset -- --profile <key> --lang <code> [--include-unreviewed]
  [--include-tts] [--min 1 --max 15] [--dry-run]`

What is selected:

- takes of that profile and language with `status = done`, provider `manual`;
- review status `approved` (`--include-unreviewed` adds unreviewed takes; rejected never);
- one take per (owner, scene, speaker): the selected take, else the newest approved;
- clips shorter than 1 s or longer than 15 s are left out and reported (`--min`/`--max`).
- `--include-tts` adds approved TTS takes. **Not for training a voice**: it would teach the
  model another engine's voice, and most TTS terms forbid it.

Consent: a profile whose consent is `pending` or `revoked` is refused. `signed` and
`not_needed` (Anton's own voice) pass.

## What the folder contains

`MEDIA_ROOT/voice/_datasets/<profile-key>-<language>-<YYYYMMDD-HHmm>/`

| File | Content |
|---|---|
| `wavs/take<id>.wav` | 22,050 Hz mono 16-bit PCM, silence trimmed lightly (< -50 dB), loudness-normalised (`loudnorm`, single pass, -23 LUFS) |
| `metadata.csv` | LJSpeech: `id\|text\|normalized_text`, no header. Text verbatim (NFC; ã ẽ ĩ õ ũ ỹ g̃ and the puso kept); a `\|` in the text becomes ` / `, line breaks a space. `normalized_text` spells out numbers for Spanish (es, es-PY, jopara); other languages repeat the text |
| `dataset.json` | counts, total seconds, per-clip seconds, sample rate, source take ids, left-out takes, export options |
| `README.md` | the speaker, consent person/scope/dates, a pointer back here |

The folder is written under a `.tmp-…` name and renamed when complete.

## How much audio

- 1–2 hours of clean speech: minimum for a usable fine-tune.
- 3–5 hours: good.
- One speaker per voice; never mix narrators in one dataset.
- Same mic, same room, same distance; quiet background; no music or effects.
- Varied sentences (questions, exclamations, names) beat repeating the same lines.

## Training later (guidance, not tested here)

An outline for a Piper (VITS) voice on a rented GPU:

1. Rent a GPU on RunPod or Vast.ai (an RTX 3090/4090 or A100). A fine-tune from an existing
   checkpoint takes a few hours to a day; expect roughly **$10–40**.
2. Copy the dataset folder there (scp/rsync from the PC). Piper's preprocessing reads
   LJSpeech (`--dataset-format ljspeech`, `--sample-rate 22050`, `--single-speaker`).
3. Pick a language for phonemes: espeak-ng has Spanish; for Guaraní use Spanish phonemes or
   a character-based (text) model — test which sounds better.
4. Fine-tune from a pretrained checkpoint (medium quality) rather than training from scratch;
   listen to checkpoints as you go and stop when it stops improving.
5. Export to ONNX and bring the model back to the PC.

**Licences:** check that the base checkpoint and its training data allow commercial use
before publishing anything made with the voice. The consent scope in the dataset README
must also cover AI training and the intended use.
