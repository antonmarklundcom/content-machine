---
description: Voice a content-engine line manifest with Higgsfield's text-to-speech engines and save each take's audio under MEDIA_ROOT.
argument-hint: <voice manifest from content-engine (fenced JSON)>
---

# /higgsfield-voice — narration takes from a line manifest

Input: `$ARGUMENTS` — a fenced ` ```json ` block content-engine builds
(build 5 §1.1, `src/lib/higgsfield/voice.ts`):

```json
{
  "jobRef": "content-engine job #42",
  "ceilingCredits": 12,
  "lines": [
    {
      "lineId": 311,
      "model": "text2speech_v2",
      "variant": "elevenlabs",
      "voiceType": "preset",
      "voiceId": "…",
      "text": "the exact text to speak",
      "outFile": "voice/story_scene/story-tito/S02-1/es-PY/take-311.hf.mp3",
      "estimateCredits": 0.13
    }
  ]
}
```

**Run this in Claude Code on Anton's PC** with the Higgsfield MCP connected.
It writes into `MEDIA_ROOT` (the media drive); if that is not connected, stop
and say "media drive not connected" before spending anything. The app holds no
Higgsfield key; it turns your files into takes when the run ends.

## Rules that never bend

- Speak `text` **exactly** as given: no rewording, no added words, no
  translation, no SSML. The text is approved and its respellings are already
  applied. Never generate a line that is not in the manifest.
- Never Guaraní (content-engine never sends it; refuse if a line looks like it).
- Every `lineId` is voiced at most once. **Never resubmit an uncertain line**:
  if a submission's result is unclear, look its job up with `jobs_wait` (or
  `show_generation_by_ids`) before doing anything else with that line.
- Stay under `ceilingCredits` (and the run rules' ceiling, which wins).

## 1. Balance and cost

1. `balance` → print `HF_BALANCE before <credits>`.
2. Group the lines by (`model`, `variant`). For each group, call the generation
   tool with `get_cost: true` on one representative line (the longest) and scale
   by characters to the group's total. Sum the groups.
3. If the total is above `ceilingCredits` or the balance, stop before
   generating anything and report the numbers. If only part fits, voice the
   lines in manifest order up to the ceiling and print `HF_FAIL <lineId> over
   the credit ceiling` for the rest.

## 2. Submit — batches of at most 12

Use `generate_audio_batch` (or `generate_audio` for one line), at most 12
lines per call, `params` per line:

- `text2speech_v2`: `{ model, prompt: text, voice_type, voice_id, variant }`.
- `elevenlabs_v4` / `elevenlabs_v4_turbo`: no top-level voice —
  `{ model, dialogue: [{ text, voice_type, voice_id }] }` (≤ 10,000 characters).
- `seed_audio`: `{ model, prompt: text, voice_type, voice_id, format: "wav" }`
  (leave `sample_rate` and `speech_rate` at their defaults).
- `qwen_audio_tts`: `{ model, prompt: text, voice_type, voice_id }`.

`voice_type` is the line's `voiceType` (`preset`, or `element` for a voice
cloned in Higgsfield); `voice_id` is its `voiceId`. Right after each submission
returns, print one line per submitted line: `HF_JOB <lineId> <higgsfield job id>`.
A line the tool rejects: print `HF_FAIL <lineId> <short reason>` and go on
(retry once only when the error says it is temporary).

## 3. Wait and download

`jobs_wait` on the submitted job ids (re-wait until each is completed or
failed). For each completed line download the audio URL with exactly:

`node "<repository>/scripts/media-download.mjs" "<MEDIA_ROOT>" "<outFile>" "<url>"`

If the result is a different format than `outFile`'s extension (e.g. WAV for an
`.mp3` name), keep the same name and change only the extension. Then print
`HF_FILE <the path you saved, relative to MEDIA_ROOT>`. A failed job: print
`HF_FAIL <lineId> <reason>`.

## 4. End

`balance` → `HF_BALANCE after <credits>`, then `HF_CREDITS <credits spent>`.
Report: lines voiced, lines failed (with why), credits estimated vs spent. Do
not write a manifest and do not run `npm run media:scan`: content-engine
converts each file to a WAV master + MP3, measures it and registers it.

When the prompt carries **Run rules** from content-engine, they win: the credit
ceiling is hard and nobody can answer a question (stop and report instead of
asking).


For headless runs, use the exact staged downloader command in the Run rules. It validates and atomically promotes complete bytes, refuses overwrites, and leaves interrupted staging hidden from scans. Never download directly to a final filename.
