# Phase S3 — Inbox UI + capture ergonomics. Paste into a fresh SONNET session, ONLY after O2 is merged.

Read `PLAN.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`.
Execute plan §6.S3 under the autonomy protocol §4. Build nothing outside
the plan.

HARD LIMITS (§4.7): no schema, auth, spend-cap, or ingest/analysis-pipeline
changes. Read data ONLY through `src/lib/bridge/` and the O2 endpoints. If a
limit blocks you: workaround + note in §10 Backlog — never a foundation edit.

Phase rules:
- Branch `phase/s3-inbox-ui` off latest main. O2 unmerged ⇒ finish it first.
- Match the app's existing UI conventions — copy the patterns of the
  existing `/youtube` list views and the brand pages; no new UI libraries,
  no redesigns of existing pages beyond adding the promote/seed buttons.
- The capture path is the point of this phase (§1.6): the `share_target`
  manifest + `docs/CAPTURE.md` (exact iOS Shortcut steps, Bearer header,
  request body) are exit criteria, not extras.
- Mobile-first for the inbox and the share-target landing page — they will
  be used from a phone mid-scroll.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4.

Exit: build/lint/typecheck green; manifest with `share_target` served and
valid; on dev the full flow works: save (form AND simulated share POST) →
inbox → promote to a brand → idea visible with its source link; YouTube
clip rows link to their video page; `docs/CAPTURE.md` committed; PR merged.

## After this phase — hand off to the next (fresh session)

Only when all four §4.9 gates pass: spawn a NEW session via `create_session`
— inherit environment and permission mode (never `plan`), `model` Sonnet,
prompt exactly:
`Read prompts/sonnet-4-worker-igfb.md in this repo and execute it.`
Never on a Fable/Mythos-class model (§1.11). Fallback without
`create_session`: same model, so continue in this window.
