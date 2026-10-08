# Subscription mode: use your Claude or Codex plan instead of API credits

The studio's writing work — title ideas, scripts, and the studio reports — can be
done by the **Claude Code CLI** or the **Codex CLI** already logged in on your PC,
so it counts against your Claude / ChatGPT subscription instead of Gemini credits.

| Work | Who does it |
|---|---|
| Titles, scripts, competitor report, repurposing, post-recording pack, filming plan | `AI_PROVIDER` (Gemini, Claude CLI or Codex CLI) |
| YouTube digests, screening, batch analysis | Gemini (bulk, a fraction of a cent each) |
| Fetching captions, channel stats, comments | No AI — YouTube Data API + captions |

## Set up (once)

1. Install and log in to one CLI in PowerShell:
   - Claude Code: install from claude.com/claude-code, then run `claude` once and log in.
   - Codex: `npm install -g @openai/codex`, then run `codex` once and log in.
2. In `.env` add `AI_PROVIDER=claude` (or `codex`). Restart the app.
3. Generate a script. The spend meter stays at $0 for that call; the model runs on your plan.

## Good to know

- It only works when the app runs on the same PC as the logged-in CLI (the local setup).
- A script takes 1–5 minutes: the CLI researches with web search before it writes.
- Subscription plans have usage limits. A few scripts a day is fine; if you hit the
  limit, the error says so — switch `AI_PROVIDER` back to `gemini` for that day.
- The CLI runs with read-only / no-file-edit instructions; it only returns JSON.
- Every answer is checked against the same script contract as Gemini's, so a bad
  answer is rejected the same way ("Try again").
