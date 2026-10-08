# Caption fetching: what to do if Vercel's IPs are blocked

**Status (2026-09-26, PLAN.md §1.27–§1.28): the app runs locally, so captions
are fetched from Anton's home IP**, which YouTube does not block the way it
blocks datacenters. None of the options below are needed for that setup. What to do on the PC:

1. Run `npm run yt:probe-captions` once, from the PC. Expect `PASS`.
2. Paste the `CAPTION_STRATEGIES=…` line it prints into `.env`.
3. Leave `CAPTION_PROXY_URL` unset.

A video without captions at all can still be analysed: the owner clicks the
no-captions fallback, which sends the YouTube URL to Gemini (PLAN.md §1.35,
priced per video from its length, never run by the poller).

The rest of this document applies **only if the app is deployed to Vercel or
another datacenter host** — it was written before the local-first decision and
is kept for that case.

## The one assumption everything rests on

The YouTube tool's entire cost model assumes caption text is **free**: the
pipeline downloads a video's existing caption track and pays the model only to
analyse it. `src/lib/youtube/captions/` exists to make that assumption hold —
six strategies, tried in order, each a different way of asking YouTube for the
same timedtext URL.

The risk is not that YouTube removes captions. It is that YouTube refuses to
talk to the machine asking. YouTube blocks datacenter IP ranges aggressively
(HTTP 403/429, `LOGIN_REQUIRED`, or the "Sign in to confirm you're not a bot"
wall), and **Vercel's serverless functions run on datacenter IPs**. Caption
fetching was built and partially tested against Hostinger's IP; nobody has yet
run it from Vercel.

If it turns out to be blocked, there are exactly three ways out. They are laid
out below with the numbers, followed by a recommendation and the one command to
run first.

## First: find out which situation you're in

After deploying, from the deployed environment:

```bash
npm run yt:probe-captions
```

(`scripts/probe-captions.ts` — it runs every strategy against three
known-captioned videos, prints the outbound IP it actually left from, and exits
0 only if every caption-bearing video returned real text.)

Read the ENVIRONMENT block first: the `outbound IPv4` line is what makes the
run evidence rather than a claim. Then read the verdict:

| Verdict | What it means | What to do |
| --- | --- | --- |
| `PASS` | Captions work from Vercel. | Copy the printed `CAPTION_STRATEGIES=…` line into the Vercel env so the pipeline stops paying for dead strategies. Nothing else in this doc applies. |
| `FAIL`, refusals are 403/429/bot wall | The datacenter-IP problem. | Pick an option below. |
| `FAIL`, every strategy refused in under 50ms | Not YouTube — an egress proxy or firewall on the host answered. | Fix outbound access, re-run. This says nothing yet about the IP question. |
| `FAIL`, no explicit block | Something else (DNS, no outbound network, YouTube outage). | Check outbound access before concluding anything. |

The probe is the only thing that distinguishes these, and it costs nothing to
run. Do not skip it and start buying proxies.

Note that the app no longer needs the probe to *survive* a blocked host: as of
this change, strategies that fail three times in a row are retired for the rest
of a run (`src/lib/youtube/captions/health.ts`), so a blocked deployment pays
a bounded ~18 failed attempts per run instead of six timeouts per video. That
makes a bad outcome cheap, not fine — the options below are still the fix.

## The cost baseline

From this repo, not from memory:

- Analysis is Gemini 3.1 Flash-Lite at $0.25/M input and $1.50/M output
  (`src/lib/analysis/pricing.ts`), halved again by the Batch API.
- A transcript is estimated at ~5,000 input tokens (`scripts/backfill.ts`).
- `.env.example` records the working figures the tool was budgeted against:
  **~$0.02 to analyse a video**, ~$0.001 to screen one out first.
- The default hard cap is **`MONTHLY_SPEND_CAP_USD=25`**, and the poller
  *refuses to start* a batch that would exceed it.

So a month of 100 analysed videos costs about **$2** while captions are free.
That is the number every option below has to be compared against.

## Option 1 — Pay for a residential proxy

Route caption requests (and only caption requests) through a residential IP.

**Already wired.** Set one variable:

```
CAPTION_PROXY_URL=http://user:pass@residential.example.com:8080
```

`src/lib/youtube/captions/proxy.ts` picks it up, builds an undici `ProxyAgent`,
and every caption fetch — including the youtubei.js strategy and the probe's own
outbound-IP lookup — goes through it. Unset, nothing changes and no proxy code
runs. Credentials are redacted everywhere they're printed. `HTTPS_PROXY` is
deliberately *not* read, so an ambient variable on some host can never silently
start spending proxy bandwidth.

**Cost.** Bandwidth is not the driver: a player response plus a caption track is
on the order of a megabyte, so even 1,000 videos a month is about 1 GB. The
driver is the **minimum monthly commitment** — residential providers typically
start around $25–$50/month, with per-GB rates of roughly $3–$15. Check the
current pricing when you buy; the shape of the answer is what matters:

> The proxy subscription costs more than all the AI analysis it protects.

That sounds damning and isn't. It is a fixed ~$25–$50/month that keeps the
per-video cost at ~$0.02 no matter how many videos there are, and it is the only
option that takes zero engineering.

**Downside:** a recurring bill roughly equal to the app's entire existing budget,
for a problem that may go away on its own.

## Option 2 — Fall back to transcribing audio

Stop relying on captions; download the audio and pay a model to transcribe it.

**Cost:** PLAN.md §1 puts this at roughly **20x** the caption path — call it
~$0.40 per video against ~$0.02. Against the default `MONTHLY_SPEND_CAP_USD=25`
that is about **60 videos a month before the poller refuses to submit anything
at all**. A single channel polled hourly can produce that.

It is also the largest change: audio download, storage, a transcription step,
and new per-video accounting through the spend guard. And ASR output is
unpunctuated, which the caption layer already documents as measurably degrading
the analysis (`selectTrack` prefers manual tracks for exactly this reason).

**This is the option to avoid.** PLAN.md §6 already treats it as needing an
explicit human decision, and both `scripts/ingest.ts` and
`scripts/probe-captions.ts` print a warning against reaching for it. Nothing
learned since changes that.

> The ~20x and §6 references come from the build-1 plan
> (`docs/PLAN-v1-build1.md`); PLAN.md §1.8 still rules out audio transcription.
> The §1.35 no-captions fallback is a different thing: one owner-clicked Gemini
> call on the video URL, not an audio pipeline.

## Option 3 — Move just the caption fetch to a non-datacenter host

Keep the app on Vercel; make one small authenticated endpoint elsewhere whose
only job is "given a video ID, return caption text", and have the pipeline call
that instead of YouTube directly. The obvious host is the Hostinger box the
owner already pays for and on which caption fetching already partially worked.

**Cost:** $0 marginal on the existing Hostinger box, or ~$4–5/month for a small
always-on VPS.

**Cost in work:** the endpoint, a shared secret, and a strategy in the caption
layer that calls it — perhaps half a day, plus a second deployment target to
keep alive. `CAPTION_PROXY_URL` does not cover this: an HTTP proxy on a box you
control still leaves *that box's* IP doing the fetching, which is the point, but
a real caption relay wants to be a request you can retry and cache, not a raw
tunnel.

**The catch:** a cheap VPS is a datacenter IP too. This option only works
because the *specific* Hostinger IP was observed to work — it is not a general
defence, and it can stop working the same way Vercel might have. Re-run the
probe from whatever box you pick before committing to it.

## Recommendation

**Run the probe first. Assume nothing until it has printed a verdict.** There is
a real chance Vercel is fine, in which case all of this is moot and the only
action is pasting `CAPTION_STRATEGIES=` into the Vercel env.

If it comes back blocked:

1. **Start with Option 1 on a trial/metered plan** — not because it is the
   cheapest steady state, but because it is a config change measured in minutes
   and it *proves the diagnosis*. If captions start working the moment traffic
   leaves a residential IP, the problem is definitively IP-based blocking. If
   they still fail, it was never the IP and the other two options would have
   been wasted work.
2. **Then decide between keeping the proxy and building Option 3**, on volume.
   Below a few hundred videos a month, ~$25–$50 for a proxy against a ~$2 AI
   bill is poor value and the Hostinger relay is worth the half day. Above that,
   or if the Hostinger box is due to be retired, keep paying for the proxy — it
   is the only option with no second host to maintain.
3. **Do not adopt Option 2.** At ~20x it does not survive contact with the
   existing $25 cap, and it degrades the analysis it pays for. Revisit it only
   if both other options fail — i.e. if captions cannot be fetched from *any*
   IP available, which would be a different problem than the one this doc is
   about.

## Quick reference

| | Option 1: residential proxy | Option 2: audio transcription | Option 3: relay via own host |
| --- | --- | --- | --- |
| Per video | ~$0.02 (unchanged) | ~$0.40 | ~$0.02 (unchanged) |
| Fixed monthly | ~$25–$50 | $0 | $0–$5 |
| 100 videos/month | ~$27–$52 | ~$40, over the $25 cap | ~$2–$7 |
| Engineering | none — one env var | large | ~half a day |
| Already wired? | **yes** | no | no |
| Risk | recurring cost | cap exhaustion, worse analysis | that host's IP gets blocked too |

## Related configuration

All in `.env.example`, all optional:

- `CAPTION_PROXY_URL` (or `PROXY_URL`) — Option 1's switch.
- `CAPTION_STRATEGIES` — the allowlist of strategies, in order. Set it to
  whatever a passing probe prints. Health tracking prunes within this list; it
  never adds a strategy you left out.
- `CAPTION_FAILURE_THRESHOLD` — consecutive failures before a strategy is
  dropped for the rest of a run. Default 3; 0 disables. The reasoning for 3 is
  in `src/lib/youtube/captions/health.ts`.
- `CAPTION_DELAY_MS` — pacing between videos, so a working IP stays working.
