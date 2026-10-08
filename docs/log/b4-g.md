# B4-G — Growth: comment drafts, content gaps, results, lead links

Branch `worktree-agent-a35a10d83f5d79759` off the build 4 foundation `d1998d8`.

## Built

- `src/lib/comments/`: Graph sync of IG comments (+ replies) on posts published ≤14 days on linked professional accounts → `comment_drafts` (upsert by platform + comment id, own comments skipped, already-answered → `replied`, token error → integration `expired`).
- Reply drafting via `structuredJson` (injectable seam): account language + `content/style/*` guide, kit CTAs/dos/don'ts, caption, lead link, ranked facts (verified as fact, unverified hedged); price/legal comments are always flagged "needs a person" (model flag + keyword check).
- `/comments` (account + status chips, edit, Draft/Draft again, Approve, Copy, open comment, Mark replied, Dismiss, Reopen, "Draft all new" with estimate); `src/lib/comments.actions.ts`; `scripts/comments-sync.ts` (`--days`, `--draft`, `--limit`).
- `src/lib/gaps/`: inputs (90-day competitor posts, last 3 reports, open audience questions; own published posts, ideas, script titles) with refs; prompt + validation (refs must exist, ≥1 market ref, score clamp 1–10, dedupe, max 10); store; Make idea (proposed idea, gap → `planned` + `idea_id`, idempotent); dismiss.
- `/research/gaps?brand=` (input counts, run with estimated cost, list by score, evidence links, show dismissed); `src/lib/gaps.actions.ts`; `scripts/gaps-find.ts` (`--brand`, `--dry`).
- `src/lib/results/`: pure aggregation (latest snapshot, rate, by-group stats, top 10, hook shape, follower trend, sparkline points, range) + `load.ts`; `/results` (brand/account/days or from–to, totals, follower sparklines, top 10, by format/account/language/mechanic/hook, all posts).
- `src/lib/leads/`: pure `buildLeadUrl`, store (`setKitLeadBase`, `setPostLeadUrl`, `fillPostLeadUrl`), `src/lib/leads.actions.ts`; components `LeadLinkField`, `KitLeadBaseField`.
- `dict/growth.ts` (en + sv), `docs/GROWTH.md` (incl. VenderCRM). Tests: 4 unit files (`leads/url`, `comments/prompt`, `gaps/validate`, `results/aggregate`), 3 integration files `tests/integration/b4-g-{comments,gaps,results}.test.ts`.

## Decisions

- The Gemini fake (`ai-fake.ts`, not owned) throws on unknown schemas, so drafting and gap finding take an injectable `model` (default `structuredJson`, same signature); tests pass a fake that validates against the caller's schema with `ai-fake`'s `validate`.
- "Needs a person" lives in `comment_drafts.error` behind the prefix `needs-human: ` (no schema column); the draft is a holding reply.
- Engagement rate = (saves + shares + comments) / reach, the "what worked" rate (§1.51); group rate = mean of post rates; likes shown, not counted. Re-implemented in the pure module because `what-worked.ts` is `server-only`.
- `buildLeadUrl` keeps the base byte for byte; `utm_*` already on the base win; campaign defaults to the handle; non-http(s) bases throw `LeadUrlError`.
- Comment sync never overwrites a worked-on row; a `new` row gets an edited comment's new text.
- `KitLeadBaseField` lives in `src/components/LeadLinkKitBaseField.tsx` (Owns prefix is `LeadLink*`).

## Known issues

- Live Graph path UNVERIFIED: comment fields/paging per Meta docs, not a live capture; reading comments needs `instagram_manage_comments` on the Meta login (O12 asks for publishing scopes; check it is included).
- Comment permalink `…/p/<code>/c/<comment-id>/` is Instagram's web URL format, UNVERIFIED; falls back to the post permalink.
- Facebook Page comments are not synced (IG only, per §3.G).
- Gap and reply cost estimates use the default model's rates; the real `structuredJson` model is `GEMINI_MODEL` (an unknown model estimates at the Pro rate, the safe side).
- Hook shape is a keyword heuristic (en/es/pt/sv).

## Link pass

- `package.json` scripts: `"comments:sync": "tsx --conditions=react-server scripts/comments-sync.ts"`, `"gaps:find": "tsx --conditions=react-server scripts/gaps-find.ts"`.
- Nav/home: `/comments` (Comment replies), `/results` (Results), `/research/gaps` (Content gaps, next to Research → Instagram).
- Mount `<LeadLinkField postId={post.id} current={post.leadUrl} kitBase={kit?.leadBaseUrl ?? null} />` in `src/app/posts/[id]/page.tsx` (next to `PostEditor`; needs `getBrandKit(post.brandId)`).
- Mount `<KitLeadBaseField brandId={brand.id} current={kit?.leadBaseUrl ?? null} />` (from `@/components/LeadLinkKitBaseField`) in `src/app/brand/[id]/kit/page.tsx` near `KitEditor`.
- Optional: add `"reply"`/`"gaps"` payloads to `src/lib/ai-fake.ts` (`classifySchema`: `reply`+`needsHuman` → reply; `gaps` → gaps) so screenshot runs can draft through the real seam.

Verification: `npm run typecheck`, `npm run lint`, `npm test` (388 pass), `npm run test:db` green locally on the final commit.
