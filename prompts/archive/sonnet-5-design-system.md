# Phase S5 — One design system. OPUS 5.5 session (effort low, §1.37). Lane 2, parallel with S6, S8, S10, S11, S12.

Read ONLY: this file, `PLAN.md` §1, §4, §6.S5, the phase table and §9 index,
and `docs/log/o6.md`. Execute under the autonomy protocol §4.

Owns:
- `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/brand/**`,
  `src/app/globals.css`, `src/app/youtube/layout.tsx` (remove its Header
  render only), `src/components/TopNav.tsx` (delete),
  `src/components/Header.tsx` (nav items + brand link), new
  `src/components/Brand*.tsx`, `src/lib/i18n/dict/brands.ts`,
  `tests/screenshots.mjs` (page list), `docs/log/s5.md`.

HARD LIMITS (§4.7): no schema, auth, spend-cap, pipeline or `src/lib/ai.ts`
changes. Reads only through `src/lib/bridge/`. Calls only the existing
`/api/generate`, `/api/ideas*` routes. If S6's `IdeaActions` component is
already on main, use it; otherwise ship a minimal card and let S9 dedupe.

Budget: one session, ≤ 90 min. Open the PR the turn the exit criteria pass.

Phase rules:
- Branch `phase/s5-design-system` off latest main.
- This is a port, not a redesign: same information, same actions, the
  YouTube half's tokens/utilities (`surface-card`, `surface-border`,
  `text-[var(--color-ink)]`, `Skeleton`, `CopyTextButton`, `ErrorPanel`).
- `RootLayout` renders `Header` once for the whole app; `Header`'s nav
  gains `Content` → `/` first; `TopNav` goes away. Login page still renders
  without a DB read (see Header's existing guard).
- `BrandIdeas.tsx`: server component list + small client islands. All copy
  through `t()` from `dict/brands.ts` (en + sv). Generate/seed buttons keep
  calling `/api/generate`; show the 403 message when the user is not owner.
- Delete `@layer legacy`, every `:not([data-youtube-section] *)`, and
  `data-youtube-section` if nothing else reads it.
- ONE screenshot pass at 390 and 1280: `/`, `/brand/propia`, `/inbox`,
  `/youtube`, `/youtube/login`; put that list in `tests/screenshots.mjs`.
- Re-runnable; minor issues → `docs/log/s5.md`; stop only per §4.4.

Exit: `grep -rc "legacy\|data-youtube-section" src` finds nothing;
`npm run verify` green; screenshots in the CI artifact; PR merged; log +
§9 line.

## After this phase
Follow `prompts/_handoff.md`. Spawn nothing.
