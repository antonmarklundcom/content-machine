# Playbook — Instagram

Instructions for drafting one Instagram post. Follow every rule unless the brief overrides it.
Write in the style guide's language and register; the examples below are English patterns to adapt, not translate.

## One post, one job
- One hook, one engagement mechanic, one call to action. Never stack "comment, save and share".
- Pick the mechanic from the goal before writing anything else:
  - Reach new people → `share` (the post must be useful to someone the viewer knows).
  - Be kept and returned to → `save` (checklists, numbers, steps, comparisons).
  - Conversation and signal to the algorithm → `question` (one question, easy to answer).
  - Leads / DMs → `comment_keyword` (only when there is a real thing to send).
  - Quick interaction on a low-effort topic → `poll` or `quiz`.
  - Returning audience → `series` (Part 1/2/3 or a recurring format).
- Write the choice in `engagement.mechanic` and the exact prompt or keyword in `engagement.detail`.

## Hooks (the `hook` field and slide 1 / shot 1)
Max ~10 words. Specific. No greeting, no brand name, no "Did you know".
- Contradict a number people repeat: "Everyone says 90 days. It's 45."
- Name the mistake: "The document most people forget until it's too late."
- "X things nobody tells you about Y": "3 things nobody tells you about opening a bank account here."
- Before/after: "Month 1: lost in paperwork. Month 3: done. What changed."
- Direct promise: "Your whole checklist in 8 slides."
- Question the viewer can't ignore: "Still paying for this every month?"
- Result first: show the finished thing, then how.
Never promise what the post does not deliver. The hook's claim must be backed by a FACTS entry or a cited source.

## Carousels (`slides`, 7–10)
Slide 1 is a cover: one headline, big `visual.textOverlay`, no paragraph. The last slide carries the CTA.
Each slide: `headline` ≤ 8 words, `body` ≤ 30 words, one idea. End slides 1–(n-1) so the next swipe feels necessary.
Arc A — "Steps" (how-to):
1 Hook/promise · 2 Why it matters (the cost of getting it wrong) · 3–7 One step per slide, numbered · 8 Common mistake · 9 Recap in one list · 10 CTA (save or comment keyword)
Arc B — "Myth vs fact":
1 Contradicting hook · 2 The myth, stated fairly · 3 What is actually true (with source) · 4–6 What that means in practice, one point each · 7 What to do instead · 8 CTA (share: "send this to someone who still believes it")
Arc C — "Checklist / save-me":
1 "Save this before you ___" · 2 Who it's for · 3–8 One checklist item per slide with a concrete detail (number, place, document) · 9 Full checklist on one slide (the screenshot slide) · 10 CTA (save)
Visual prompts: describe a photo or clean graphic in English, no text inside the image — text goes in `visual.textOverlay`.

## Single image (`image_post`)
One slide. Overlay ≤ 8 words that works without the caption. Use for a single stat, a quote, a before/after, a local photo with a strong claim.

## Reels (`shots`, 15–45 s)
- Shot 1 (1–2 s) is the hook: movement or a surprising visual plus `onScreenText` that states the hook. No logo intro, no "Hi guys".
- Every shot has `onScreenText` (many watch muted). ≤ 7 words per shot, readable in 1 s.
- Cut every 2–4 s. One idea per shot. Put the payoff near the end, not the middle.
- `voiceover` is spoken lines from the style guide: short, one breath each.
- Loop ending: the last line leads back into the first ("…and that's why it's never 90 days." → hook says "Everyone says 90 days").
- The CTA is one short shot or spoken line at the end, same as `cta`.
- `imagePrompt`/`videoPrompt`: English, vertical 9:16, real-looking places and objects, no real people's likenesses, no text in frame.

## Stories (`storyFrames`, 3–7)
Default sequence: poll → quiz → question → link.
1 Hook frame, no sticker or a `poll` ("Did you know this changed?" Yes / No)
2 `quiz` with one correct answer that teaches the point
3 The answer + one line of context
4 `question` sticker ("What's your biggest doubt about ___?")
5 `link` sticker to the resource, with a reason to tap
Frame `text` ≤ 15 words. Stickers ask one thing. Only use `link` when the brief gives a URL.

## Comment-keyword CTAs
- Use only when there is something concrete to send: a checklist, a PDF, a price list, a booking link.
- One keyword, one word, ALL CAPS, easy to spell in the post's language: GUIDE, LIST, PRICE, GUIA, LISTA.
- Wording: "Comment GUIDE and I'll send you the checklist by DM."
- Put the keyword alone in `engagement.detail` and say what gets delivered in `cta`.
- Never use it to fake engagement when nothing is sent.

## Save and share prompts
- Saveable = reference value: checklists, numbered steps, costs, deadlines, comparisons, "before you ___" lists.
- Save CTA names the moment they'll need it: "Save this for the day you book your appointment."
- Shareable = useful or true for someone else: "Send this to someone who's thinking of moving."
- Put the prompt in `cta`; do not repeat it in the caption body.

## Series
- Use `series` for topics too big for 10 slides or recurring formats ("Mistake Monday", "One document a week").
- Hook and slide 1 say "Part 1/3". The last slide or shot says what Part 2 covers.
- `engagement.detail`: series name and part number.

## Caption
- First line = the hook, reworded (it shows before "more"). ≤ 125 characters.
- Then short paragraphs, 1–2 sentences each, blank line between. Add value the slides don't: context, a story, the why.
- One CTA near the end, matching `cta`.
- 150–300 words for carousels; 50–150 for reels and single images.
- Emojis: 0–3, only as bullets or markers, never replacing words.

## Hashtags (`hashtags`, without #)
- 3–8, all relevant. Mix: 2–3 niche topic tags, 1–3 local tags (city, country, community in the post's language), 1 brand tag if the brief gives one.
- No generic spam (love, instagood, follow, viral, fyp), no banned or unrelated trending tags.
- Tags in the language the audience searches in.

## First comment (`firstComment`)
Use it to extend, not repeat: the source link text, a bonus tip, or the "Part 2" pointer. Leave empty if there is nothing to add.

## Alt text (`altText`)
Describe what is visible for someone who can't see it, then the key text on the image. ≤ 2 sentences. No hashtags, no "image of".

## Do not
- Engagement bait: "Like if you agree", "Tag 3 friends", "Type YES", "Comment 🔥". Platforms demote it.
- Fake urgency or scarcity: "Only today!", "Last spots!" unless the brief states it and it's true.
- Unverifiable claims: guarantees, "100% approved", "the only", "the best". Legal figures only from FACTS, cited in `sources`.
- Clickbait hooks the post doesn't pay off.
- More than one CTA, or a CTA that asks for something the account can't deliver.
- Walls of text on slides, text baked into image prompts, English hashtags on a non-English post.
