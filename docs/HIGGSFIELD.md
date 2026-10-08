# Higgsfield hand-off (PLAN.md §1.34, §1.45, §6.S12, §6.S14)

Every Higgsfield command runs **in Claude Code on Anton's PC**, with the Higgsfield MCP connected: they write into `MEDIA_ROOT` (the external media drive, e.g. `E:\ContentEngine`; unset = `<repo>/media`), which a cloud session cannot reach. Commands that generate always ask `models_explore` (`action: "recommend"`) first, batch the jobs and wait with `jobs_wait`, write a `manifest.json` next to the files, and resume on re-run.

## Generate from the app (build 4 §1.14)

content-engine can start these commands itself and track them, still without ever holding a Higgsfield key. **This only works on Anton's PC**, where the app runs next to a logged-in Claude Code and the media drive — never on a hosted deploy (Hostinger has neither).

### What runs where

1. A button (**Generate with Higgsfield** on a post or script, or the forms on **`/higgsfield`**) asks for a **credit ceiling**, then creates a `higgsfield_jobs` row.
2. The app builds the brief server-side with the same export functions as **Brief → Copy** / **Shot list → Copy**, so the CLI needs no session cookie.
3. It spawns `claude -p --output-format stream-json --verbose` in the repo folder, with the prompt on stdin: the slash command (`/higgsfield-post`, `/higgsfield-shots`, `/higgsfield-thumbnails`, `/higgsfield-import`, `/higgsfield-free`), the inline brief, and run rules. The run rules carry the hard instruction "Spend at most N credits: check balance first, preflight with get_cost, stop before exceeding N; report balance before/after", MEDIA_ROOT's absolute path, and the progress lines to print (`HF_BALANCE before|after <n>`, `HF_JOB <id>`, `HF_FILE <path>`, `HF_CREDITS <n>`).
4. The Higgsfield MCP spends **your subscription credits**; files land under `MEDIA_ROOT`. The app reads the stream as it comes: log tail, Higgsfield job ids, files and credits go into the row, and `/higgsfield` refreshes every few seconds.
5. When the CLI exits, the row becomes `done`, `failed` or `cancelled`, and the app runs the media scan, so the files are assets at once.

From a terminal, the same runner: `tsx --conditions=react-server scripts/higgsfield-run.ts --kind post --target 12 --max-credits 15` (kinds `post`, `script_shots`, `script_thumbnails`, `import [--range "last 50"]`, `free --brand <id> --description "…"`; `--preflight` only checks). `scripts/higgsfield-reap.ts` fails runs whose process is gone.

### Prerequisites

1. **Claude Code installed and logged in on the PC**, with your Claude subscription: install it as described on Anthropic's Claude Code docs, run `claude` once in a terminal and `/login`. If `claude` is not on the app's PATH, set `CLAUDE_CLI_PATH` (the app also reads `CLAUDE_CLI_BIN`, like subscription mode). Do not set `ANTHROPIC_API_KEY` unless you want runs billed to that key.
2. **The Higgsfield MCP available to the CLI** — either:
   - add it for the CLI: `claude mcp add --transport http higgsfield <Higgsfield MCP URL>` (take the URL from Higgsfield's own MCP / "connect to Claude" setup page; it is not copied here because it cannot be verified from this repo), then run `claude`, `/mcp`, pick it and authenticate; or
   - connect Higgsfield in **claude.ai → Settings → Connectors** with the same account the CLI is logged in with. Recent CLI versions list such connectors in `claude mcp list` as `claude.ai <Name>`; if yours does not, add it for the CLI as above.
   If the server has an unusual name, set `HIGGSFIELD_MCP_SERVER=<name as in claude mcp list>`.
3. **`MEDIA_ROOT`** set in `.env` to the media drive, plugged in.

**Ready to run?** on `/higgsfield` checks all three (the drive, `claude --version`, a one-word `claude -p` ping, `claude mcp list`) and shows the fix for each failure. The ping uses a sliver of your Claude subscription, so it only runs when you press **Check now**.

### Permissions — what the headless run may do

A headless run cannot ask for permission, so anything not pre-approved is denied. The app passes `--allowedTools` with only:

- `mcp__<server>` for the Higgsfield server(s) — this form allows every tool of one MCP server (a claude.ai connector named `claude.ai Higgsfield` becomes `mcp__claude_ai_Higgsfield`);
- `Read(//<MEDIA_ROOT>/**)`, `Write(//<MEDIA_ROOT>/**)`, `Edit(//<MEDIA_ROOT>/**)` — `//` marks an absolute path in a rule; a Windows drive is written POSIX-style (`E:\ContentEngine` → `//e/ContentEngine`);
- `Read(.claude/commands/higgsfield-*.md)` — the fallback if a slash command is not expanded;
- `Bash(curl -fsSL --create-dirs -o "<MEDIA_ROOT>/:*)` — the download command, only into MEDIA_ROOT.

Allow rules in your own Claude Code settings (`~/.claude/settings.json`, the repo's `.claude/settings*.json`) still apply on top of these; keep them narrow. The app's own secrets (`DATABASE_URL`, `SESSION_SECRET`, API keys) are removed from the CLI's environment; `CLAUDE_*`/`ANTHROPIC_*` pass through.

### Costs and the credit ceiling

- Every start asks for a ceiling; the default is `HIGGSFIELD_DEFAULT_MAX_CREDITS` (20). A single run accepts at most 2000. Imports use 0 (they spend nothing).
- The ceiling is an instruction to Claude plus a check on what it reports — Higgsfield itself does not know about it. The command checks `balance`, preflights costs and stops before the total would pass the ceiling. If the reported credits exceed it anyway, the log says so.
- Credits used = `HF_CREDITS`, else balance before − after. Your Claude subscription usage for the run is separate (the CLI's own limits).

### Limits, cancel, retry

- One run per target at a time (a post, a script, or the import); a second start says which job is running. Free prompts run in parallel.
- `HIGGSFIELD_JOB_TIMEOUT_MIN` (default 30) kills a run that is still going. **Cancel** kills it at once. Generations already submitted to Higgsfield still cost credits; their job ids are in the row, so a retry can skip them (the commands resume from their manifest).
- **Run again** starts a new row with a fresh brief (posts/scripts) or the same request (free/import).
- If the app restarts mid-run, the run's row is failed by the reaper (on the next page load or start, or `scripts/higgsfield-reap.ts`).

### Troubleshooting

- **"Could not start claude"** — not installed or not on the app's PATH: set `CLAUDE_CLI_PATH`.
- **Logged out / "Please run /login"** — run `claude` in a terminal and `/login`.
- **Higgsfield not found / failed to connect / needs authentication** — `claude mcp list` in a terminal shows the same thing; re-add or authenticate as in Prerequisites.
- **Tools denied** (the log shows `[denied] …`) — the command tried something outside the list above (e.g. `npm run media:scan`); the files are still scanned by the app.
- **"Media drive not connected"** — plug the drive in or fix `MEDIA_ROOT`, then **Run again**.
- **Files missing from the run** — every terminal state reconciles the output folders in the stored brief, including failures, cancellation and reaped runs without `HF_FILE` markers. Partial successes are registered once and appear in the job's file list; the terminal failure/cancel state is preserved. A missing drive or scan error is logged and reconciliation retries on the next reaper run. For a legacy prompt with no safe output folder, use **Scan now** on `/media`.

## Voice (build 5)

Higgsfield's text-to-speech engines make narration takes on your existing credits. Same bridge as above: the app queues a `voice` job, Claude Code runs `/higgsfield-voice` with the Higgsfield MCP, and the files become takes when the run ends. **PC only** — it needs Claude Code, the MCP and the media drive; the online app refuses.

### Engines and prices

Measured with `get_cost` on 2026-10-07, for ~950 characters (≈ 1 minute of Spanish):

| Engine (`model` / `variant`) | Credits per ~950 chars | Notes |
|---|---|---|
| `text2speech_v2` / `elevenlabs` | 2.7 | preset or cloned voices |
| `text2speech_v2` / `minimax` | 2.7 | |
| `elevenlabs_v4` | 4.14 | sent as `dialogue: [{text, voice_type, voice_id}]`, ≤ 10,000 chars |
| `seed_audio` | 5.9 | returns WAV |
| `qwen_audio_tts` | 0.38 | no Spanish in its language list — refused for `es-PY`/`jopara` |

Other `text2speech_v2` variants and `elevenlabs_v4_turbo` are not measured; the app estimates them high (5.9 and 4.14). The app's estimate scales the price by characters and is only used to refuse a batch whose estimate is above the ceiling; the command's `get_cost` is the truth.

### A Higgsfield voice profile

On `/voice`, add a profile with provider **Higgsfield**: engine, variant (only for `text2speech_v2`), voice type and voice id. There is no "Load voices" here — the app cannot reach the MCP. Run `list_voices` in Claude Code (it lists each `voice_id` with its `voice_type`) or copy the id from Higgsfield. Guaraní is never offered (no TTS speaks it).

### Cloning a voice (element)

1. Get the person's signed consent first (build 4 §1.5): AI use, where it is used, how long, right to revoke.
2. In Higgsfield, **Create Voice** from a clean sample of that person (or `create_voice` in Claude Code). Higgsfield gives an element id.
3. Add a profile with voice type **Element** and that id. Its consent starts **pending**; upload the signed consent on the profile and set it to **signed**. Until then every line using it is refused (`consent_missing`), as is an expired consent.

### Making takes

- **One line**: `HiggsfieldVoiceLineButton` next to the take list (pick a Higgsfield voice, a ceiling, Queue).
- **A whole book language**: **Narrate with Higgsfield** on the story page — every approved line without a usable take, narrator profile for narration and each character's own Higgsfield profile by character key (else the narrator reads it, noted).
- **A script**: the same button on the script's Voice & video page — every spoken block (hook, sections, CTA).

Each batch shows the line count and estimated credits and asks for a ceiling. Lines are refused exactly like `narrate()` (approved text only, pending-review notices, never Guaraní, consent, an inactive voice) and a line already queued is not queued twice. Pronunciations are applied before the text goes into the manifest.

### What happens

1. The queued job, its full prompt/manifest, and one linked `pending` narration row per line commit together before the CLI is dispatched. A process death cannot leave newly created unlinked takes. Interrupted queued jobs are reaped after the grace period without automatic resubmission. Legacy orphan rows older than ten minutes are linked from a unique stored manifest or failed with a visible recovery note; generation history should be checked before a manual retry.
2. The job's prompt is `/higgsfield-voice` + the manifest (`lineId`, engine, voice, spoken text, `outFile` = `voice/…/take-<id>.hf.mp3|wav`) + the ceiling. The command checks `balance`, preflights `get_cost` per engine, submits with `generate_audio_batch` in groups of ≤ 12, prints `HF_JOB <lineId> <jobId>` at once, waits with `jobs_wait`, downloads with the curl form and prints `HF_FILE`, `HF_FAIL <lineId> <reason>` and `HF_CREDITS`.
3. When the run ends (done, failed, cancelled or reaped), each line's file becomes a WAV 48 kHz mono master + MP3, measured and registered; the row is `done` with `cost_credits` (the run's credits split by characters) and `external_ref` = the Higgsfield job id. A line without a file is `failed` with the reason. The raw `.hf.*` download is removed once the master exists.
4. A new take is selected when its slot has no usable selected take; story scenes whose lines are all ready get their scene audio rebuilt. Running the finalize twice changes nothing.

## Posts (build 3)

1. Open the post, then **Brief → Copy** — or `GET /api/posts/<id>/export?format=brief` (`&as=json` for just the JSON). Every visual has its prompt, aspect ratio and a `targetFile` relative to `MEDIA_ROOT` in the post's folder (`<brand>/<handle|_brand>/<YYYY-MM>/<post-id>-<slug>/NN-<slug>.<ext>`), plus the brand kit's Higgsfield element/character ids and style notes.
2. Run `/higgsfield-post <post-id>` (or paste the brief after it). It recommends models, uses the cheapest that fits, stops to ask before spending more than its estimate, generates the stills in one batch and image-to-video only for shots with a video prompt.
3. Files and `manifest.json` land in the post's folder. Then `npm run media:scan` or **Scan now** on `/media` registers them as assets for the brand (deduped by sha256, so re-running is safe).

## Importing existing Higgsfield history

1. Run `/higgsfield-import` (optionally `since 2026-09-01`, `last 50` or `all`). It spends nothing: it lists the account's past generations and downloads the ones not yet imported into `_inbox/higgsfield/<YYYY-MM-DD>/` with a manifest (prompt, model, job id, URL).
2. **Scan now** on `/media`; the files appear in **`/media/inbox`** (unsorted = no brand yet).
3. There, select files and tag, approve/reject/archive, or **Assign brand / account**. New assets retain their immutable `_originals/` snapshots when assigned; their brand/account metadata changes. Source downloads and manifests remain in their source folders and should be backed up too. Legacy inbox files can still be moved by the old assignment path until a scan upgrades them to originals.

## The library (`/media`)

Filters (brand or unsorted, account, status, source, kind, tag, date) are URL parameters, so every view is a link. The grid only loads thumbnails (`/api/media/asset/<id>/thumb`); the full file loads in the detail drawer (prompt, model, source link, the posts it is used in). With the drive unplugged the page says "media drive not connected" and still filters and edits metadata; moves wait for the drive.

## Scripts (build 2)

1. Write and edit a script in the studio (`/studio/new` → `/studio/<id>`), then **Save**.
2. On `/studio/<id>`, **Export → Shot list → Copy** (or download it). It is Markdown for you plus a fenced JSON block for Claude Code; every shot already has its image/video prompt, aspect ratio and target file name.
3. Open Claude Code in this repo with the Higgsfield MCP connected and run `/higgsfield-shots <script-id>` — or `/higgsfield-shots` followed by the pasted shot list.
4. The command (`.claude/commands/higgsfield-shots.md`) asks Higgsfield's `models_explore` to recommend models first, uses the cheapest that fits, and stops to ask before spending more than its estimate.
5. It generates every still in one batch, then image-to-video only for shots with a video prompt, waiting with `jobs_wait`.
6. Results land in `media/<script-id>/` (`01-<slug>.png`, `01-<slug>.mp4`, `thumb-1-<slug>.png`) with `manifest.json`: shot → file → Higgsfield URL → prompt → model.
7. Re-running resumes: finished shots in the manifest are skipped; failures are retried.
8. The app never calls Higgsfield and stores no Higgsfield key — Claude Code does the spending, with you watching.
9. `media/` is large binaries: keep it out of git (add it to `.gitignore` on your machine if it is not there yet).
10. Editing a shot's prompt later? Save the script, re-export, and ask the command to redo that shot number.

## Thumbnails (build 2b, idea 10)

1. On `/studio/<id>`, open **Thumbnails** (`/studio/<id>/thumbnails`) and **Copy** the prompts — or `GET /api/scripts/<id>/export?format=thumbnails` (`&as=json` for just the JSON).
2. Each of the script's three concepts is a numbered 16:9 prompt with its text overlay built in, and two target files: `media/<id>/thumbnails/<n>.png` and `<n>-2.png`.
3. Run `/higgsfield-thumbnails <script-id>` (or paste the prompts after it). Same rules as the shots: `models_explore` recommend first, the cheapest model that renders the text, one batch + `jobs_wait`, a manifest at `media/<id>/thumbnails/manifest.json`, resume on re-run.
4. Back on `/studio/<id>/thumbnails` the images show up (served owner-only by `/api/media/<id>/thumbnails/<file>`); **Use this one** stores the path in `scripts.thumbnail_file`.
5. `/api/media/…` serves images, videos and manifests under `media/` only — `..`, absolute paths and symlinks leading outside are a 404. Set `MEDIA_ROOT` to keep the folder elsewhere on the PC.

## Listing scripts (build 2b, idea 8)

`/studio/listing` turns a propia.com.py (or any) listing into a short (60–90 s, 9:16) or a tour (3–5 min, 16:9). Its b-roll uses the listing's own photos first: those shots' image prompt reads `LISTING PHOTO (download, do not generate): <url>`. When running `/higgsfield-shots` on such a script, download that photo to the shot's `files.image` instead of generating it, and use it as the start frame for the shot's video prompt; only the other shots are generated.
