# Voice — narration for videos and cuentos (build 4, phase A)

One voice engine for everything that speaks: social videos in castellano
paraguayo (voseo), Jopará, and the cuentos.com.py children's stories. Pages:
**/voice** (voice profiles), **/voice/pronunciations** (dictionary),
**/voice/test** (the voice gate). Code: `src/lib/voice/` — callers import only
`@/lib/voice` (`narrate`, `importRecording`, `selectTake`, `reviewTake`,
`voiceChangeRecording`).

## How a take is made

`narrate({ ownerKind, ownerRef, sceneRef, language, voiceProfileId, text, speaker, pronunciationScope })`

1. Refusals first (no row, no spend) — `NarrationRefusedError` with a reason:
   `empty_text`; `text_not_approved` (the text still says `PENDIENTE`,
   `REVISAR`, `TODO`, `pending review` or `[??]`); `language_not_supported`
   (Guaraní on a TTS voice, or a language the profile does not list);
   `consent_missing`; `provider_not_configured` (no key — the message names the
   Settings field — no voice id, a switched-off profile, or a manual profile).
2. Pronunciations are applied (below); the respelled text is kept as `spokenText`.
3. The provider is called inside `withSpendCap(estimate)`; the actual cost is
   recorded with `recordSpend`.
4. The WAV master and an MP3 playback copy (ffmpeg, 128 kbit/s mono) are written
   to `MEDIA_ROOT/voice/<owner-kind>/<owner-ref>/<scene|_all>/<language>/take-<id>.{wav,mp3}`,
   measured with ffprobe, and registered as `audio` assets. Without ffmpeg the
   WAV doubles as the playback copy.
5. The `narrations` row is `done` with duration, word timings (ElevenLabs only;
   captions fall back to proportional timing), cost and `textHash`
   (sha256 of text + voice + language: a re-take of unchanged text is visible).
   A failure after step 1 keeps the row as `failed` with the error.

Every take is kept. `selectTake(id)` makes one take the selected one for its
(owner, scene, language, speaker) in one transaction; `reviewTake(id, status,
note, reviewer)` records a listen. Playback is `/api/media/asset/<asset id>`.

## Providers

| Provider | Setup (Settings) | Voices | Timings |
|---|---|---|---|
| ElevenLabs | `ELEVENLABS_API_KEY` | stock or cloned (`GET /v1/voices`; “Load voices” on the form) | yes (per character → words) |
| Azure Speech | `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` | **es-PY-TaniaNeural**, **es-PY-MarioNeural** (stock Paraguayan Spanish) | no |
| Gemini TTS | `GEMINI_API_KEY` (model: `GEMINI_TTS_MODEL`, default `gemini-2.5-flash-preview-tts`) | prebuilt (Kore, Puck, Charon…) | no |
| manual | — | a person's recording (upload) | no |

- **ElevenLabs**: `POST /v1/text-to-speech/{voice}/with-timestamps?output_format=pcm_44100`,
  model `settings.model ?? eleven_multilingual_v2`, `voice_settings` from
  stability / similarity / style / speed. Cloned voices need consent (below).
- **Azure**: SSML with `xml:lang` from the voice (`es-PY`), optional
  `mstts:express-as` style and prosody rate (from speed) and pitch; text is
  XML-escaped; output `riff-24khz-16bit-mono-pcm`. Free tier ≈ 0.5M chars/month.
- **Gemini TTS**: the profile's style direction goes first, e.g.
  “Leé con acento paraguayo, cálido y pausado:”, then the text. Raw PCM
  24 kHz → WAV.
- **Voice changer** (ElevenLabs speech-to-speech, `voiceChangeRecording`): a
  native speaker's recording re-voiced as a profile's voice. Needs the source
  speaker's consent (always; required for `gn`). UNVERIFIED live.

All live provider paths are **UNVERIFIED** until keys are in Settings.

Test double: `VOICE_FAKE=1` (and always under tests: `NODE_ENV=test` or
`GEMINI_FAKE=1`; `VOICE_FAKE=0` forces real calls) makes every provider return
a quiet tone whose length follows the text, with word timings and the cost the
real provider would charge. Only `src/lib/voice/providers/index.ts` knows.

## Which provider for what (build 5)

Prices checked 2026-10-07 for about one minute of Spanish (~950 characters).

| Provider | Paraguayan Spanish | Clones a voice | Cost per minute | How it runs |
|---|---|---|---|---|
| Recorded narrator (`manual`) | The real thing | — (it *is* the person) | Narrator's fee | `/voice/record` studio or upload ([RECORDING.md](RECORDING.md)) |
| Higgsfield → ElevenLabs engine | From a cloned Paraguayan narrator | Yes (Higgsfield "Create Voice") | 2.7 credits | Batch job through Claude Code ([HIGGSFIELD.md](HIGGSFIELD.md)) |
| Higgsfield → MiniMax | Same | Yes | 2.7 credits | Same |
| Higgsfield → Eleven v4 | Same | Yes | 4.14 credits | Same |
| Higgsfield → Seed Audio | Same | Yes (from a recording) | 5.9 credits | Same |
| Higgsfield → Qwen | No Spanish in its language list — test first | Yes | 0.38 credits | Same |
| Azure es-PY (Tania, Mario) | Real es-PY voices | No | ~$0.016 per 1k chars; free tier ~0.5M chars/month | Direct API |
| ElevenLabs direct | From a clone | Yes, best (Professional clone on Creator) | ~$0.18–0.22 | Direct API |
| Gemini TTS | Steered by instructions | No | A few cents | Direct API (your Gemini credits) |
| Chatterbox | From a ~10 s sample | Yes | Free on the PC (slow, CPU); cents on Replicate | Local server or Replicate ([CHATTERBOX.md](CHATTERBOX.md)) |

The 10 seconds Chatterbox needs is the *sample* it copies; takes can be any
length. Higgsfield credits are shared with images, so watch the balance.

**Recommended order:** record the cuentos with real narrators (Spanish and
Guaraní) — those takes are narration now and training data later
([DATASET.md](DATASET.md)); clone the narrator in Higgsfield for new Spanish
lines; Azure es-PY for high-volume social videos; your own trained model later
for synthetic Guaraní (no TTS service speaks it).

## The Guaraní rule

No TTS service speaks Guaraní. Every TTS provider refuses `gn`
(`language_not_supported`), and a TTS profile cannot even list `gn`.
Guaraní takes are **recorded by a native speaker** and uploaded — on any
`NarrationTakes` panel (“Upload a recording”) or `POST /api/voice/recordings` —
as provider `manual`, normalised to WAV 48 kHz mono + MP3. Jopará is read by
a Spanish voice; the few Guaraní words in it come from the approved glossary and
get respellings here.

## Consent

A profile whose voice is a cloned or recorded person has `consent_status` ≠
`not_needed`. It makes takes (and accepts recordings) only while `signed` and
not past `consent_expires_at`; `pending` and `revoked` refuse with
`consent_missing`. Record who, what it covers (AI use, commercial use,
platforms, duration, right to revoke), the dates, and upload the signed
document on the profile — stored under `MEDIA_ROOT/voice/_consent/` (not a
media asset; viewable at `/api/voice/consent/<profile id>`, owner only).

## Pronunciation dictionary

`pronunciations` rows (term → say-as) are applied before synthesis by
`applyPronunciations` (`src/lib/voice/pronunciations.ts`):

- whole word, case-insensitive, Unicode-aware: ñ, ỹ, g̃ (g + U+0303) and the
  puso (`'` or `’`, interchangeable) are word characters; text is NFC-normalised;
- longest term first, one pass — a respelling is never rewritten again;
- narrower scope wins: `story:<slug>` / `brand:<id>` > `provider:<name>` > `global`;
  then an exact language beats `*`;
- only `approved` rows for real takes; previews also apply `proposed`.

On /voice/pronunciations: filter, edit (an edit goes back to `proposed`),
approve/reject with the reviewer's name, and **Preview** — two short takes,
as written and with the respelling. Word timings are mapped back to the written
words when the word count is unchanged, so captions show the original spelling.

## Costs

Estimated before the call (what the spend cap reserves); see `src/lib/voice/costs.ts`.

| Provider | Rate |
|---|---|
| ElevenLabs | `ELEVENLABS_USD_PER_1K_CHARS` (default **$0.30** / 1,000 chars) |
| Azure neural | **$0.016** / 1,000 chars (free tier not modelled) |
| Gemini TTS | $0.50 / 1M input tokens + $10 / 1M audio tokens, 25 audio tokens/s, estimated at 12 chars/s (errs high); actual from usage when returned |
| Voice changer | ≈ 1,000 chars' worth per minute of audio at the ElevenLabs rate |
| manual | $0 |

A 45-second script (~700 chars) costs ≈ $0.21 on ElevenLabs, $0.011 on Azure,
≈ $0.015 on Gemini TTS.

## The voice gate (/voice/test)

Paste ~45 s of script (or start from a studio script), pick the language, tick
2–4 voices, **Render all**. Takes are rendered side by side (owner kind
`voice_test`), with cost and duration. **Mark winner** selects that take and
approves it with your note. Do this per language (es-PY, Jopará, …) before
narrating a series. From a terminal:

    npm run voice:test -- --profiles tania,mario,ana --language es-PY --file gate.txt
    npm run voice:test -- --profiles tania,mario --text "…" --fake

## Components for other pages

- `NarrationTakes` — `{ ownerKind, ownerRef, sceneRef?, language, speaker?, text?, pronunciationScope?, locale? }`:
  the take list (player, duration, voice, cost, review, use/approve/reject),
  an upload for recordings, and — with `text`, not for `gn` — a `NarrateButton`.
- `NarrateButton` — `{ ownerKind, ownerRef, sceneRef?, language, speaker?, text, pronunciationScope?, defaultVoiceProfileId?, locale?, onDone? }`.
