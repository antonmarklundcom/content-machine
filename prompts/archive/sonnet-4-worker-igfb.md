# Phase S4 — Worker + IG/FB metadata (FINAL, conditional). Paste into a fresh SONNET session, ONLY after S3 is merged.

Read `PLAN.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`.
Execute plan §6.S4 under the autonomy protocol §4.

GATE FIRST (§1.9): find the caption-probe verdict in §9 / from Anton
(human input §7.2). No verdict ⇒ stop and ask Anton to run it — that is a
§4.4 stop, not a blocker to route around. PASS ⇒ skip the worker; build
only the IG/FB fetch Vercel-side; record the skip in §9.

HARD LIMITS (§4.7): no schema, auth, spend-cap, or ingest/analysis-pipeline
changes in the main app. The clip row's existing metadata/error columns are
the only thing the fetch writes.

Phase rules:
- Branch `phase/s4-worker-igfb` off latest main. S3 unmerged ⇒ finish first.
- Load the `nextjs-deploy-hostinger` skill BEFORE any worker deploy step —
  it has the verified fixes for this exact slot (SSH npm PATH, env loading,
  IPv6-to-Neon).
- IG/FB fetch: oEmbed/OpenGraph best-effort ONLY (§1.7). No login walls, no
  headless browsers, no paid scraping APIs, no transcription (§1.8).
  Failure is a normal outcome recorded on the clip row — one attempt per
  save + manual retry, no retry storms.
- Worker (if gated in): one authed webhook in, one callback out, shared
  secret in env both sides (`.env.example` both apps). No queue infra.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4.

Exit: build green (both apps if worker built); saved IG clip gains metadata
when fetchable and stays useful (URL + note) when not; worker, if built,
deployed and round-trips a `fetch_clip_metadata` job; §9 entry; PR merged.

## After this phase — STOP. Final report to Anton

No further sessions. Close with: what shipped per phase (PR links), live
URLs, the §7 checklist with remaining unchecked items, and exact numbered
manual steps (set `CLIP_TOKEN` in Vercel if unset, create the iOS Shortcut
per `docs/CAPTURE.md`, run the probe if still unrun). Suggest creating a
`content-engine-dev` project skill now that the build is stable.
