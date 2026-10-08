# Playbook — Facebook

Instructions for drafting one Facebook post. Facebook rewards conversation and shares into groups and chats; longer captions work here.
Write in the style guide's language and register; the examples below are English patterns to adapt, not translate.

## One post, one job
- One hook, one engagement mechanic, one call to action.
- Pick the mechanic from the goal:
  - Conversation / reach through comments → `question` (the default on Facebook).
  - Reach through groups and chats → `share` ("share this with someone who…").
  - Local community voice → `poll` ("Which neighbourhood has the best ___?").
  - Leads → `comment_keyword` only when something real gets sent by message.
  - Reference value → `save` (checklists, steps, prices, schedules).
  - Returning audience → `series` (weekly format, Part 1/2/3).
  - Light interaction → `quiz`.
- Put the mechanic in `engagement.mechanic` and the exact question, keyword or series name in `engagement.detail`.

## Hooks (the `hook` field and the caption's first line)
The first 1–2 lines show before "See more". They must earn the click. No greeting, no "Dear followers".
- Contradict a number: "Everyone says 90 days. Ours took 45."
- Name the mistake: "The one form people fill in wrong — every time."
- Nobody tells you: "5 things nobody tells you about your first month here."
- Before/after: "Last year this cost us a week. Now it takes an afternoon."
- Direct promise: "The full checklist is below. Nothing to download."
- Local angle: "If you live in [city], this changes on the 1st." (only with a sourced date)
- Story opener: "A customer came in on Tuesday with the wrong document."

## Caption (the main content on Facebook)
- First line = hook. Second line = why the reader should care.
- Then the body: 100–300 words works well. Short paragraphs of 1–3 sentences with blank lines between.
- Lists are good: numbered steps or a checklist written out in the caption are saveable.
- Tell small real stories (a customer, a day at the shop) only if the brief supplies them; never invent people.
- End with one CTA — usually a question that is easy and specific to answer: "What was the hardest part for you?" not "Thoughts?".
- Emojis: 0–3, as markers only.

## Formats
- `image_post` (default): 1:1 image, one slide. Overlay ≤ 8 words or none; the caption does the work. Local, real-looking photos beat stock.
- `carousel` (`slides`, 7–10): same arcs as Instagram, with less text per slide since the caption carries detail:
  Arc "Steps": hook → why it matters → one step per slide → common mistake → recap → CTA.
  Arc "Myth vs fact": myth → the truth (sourced) → what it means → what to do → CTA (share).
  Arc "Checklist": "Before you ___" → who it's for → one item per slide → full list slide → CTA (save).
- `reel`/`video` (`shots`): hook in the first 1–2 s with `onScreenText` on every shot (most watch muted), 2–4 s cuts, payoff late, loop or CTA ending. Square or vertical per the brief.
- `text`: only for a strong question or short story; keep it under ~80 words.
- `story` (`storyFrames`, 3–7): poll → quiz → question → link. One ask per frame, `text` ≤ 15 words.
- Visual prompts: English, no text inside the image, no real people's likenesses.

## Links
- Put external links in `firstComment`, not the caption; say "link in the first comment" in `cta` if the link is the action.
- Only use URLs the brief gives. Never guess a URL.

## Local community
- Name the place (city, neighbourhood, landmark) when the business is local. Ask about local experiences.
- Write so the post is worth sharing into a local or expat group: useful on its own, not an ad.
- Share prompt: "Share this in your neighbourhood group if it helps someone."

## Comment-keyword CTAs
- Only with a real deliverable. One keyword, one word, ALL CAPS: GUIDE, LIST, PRICE.
- "Comment GUIDE and we'll send it by Messenger." Keyword alone in `engagement.detail`.

## Save and share
- Saveable: checklists, costs, opening hours, step lists, deadlines.
- Shareable: "Send this to someone who's planning the move." One of them per post.

## Series
- Weekly recurring formats suit Facebook: "Question of the week", "Friday price check", "Mistake of the month".
- Mark parts: "Part 1 of 3" in the first line; say what's next at the end. Name it in `engagement.detail`.

## Hashtags (`hashtags`, without #)
- 0–3. Facebook barely uses them. At most one topic tag, one local tag, one brand tag. Empty is fine.

## First comment (`firstComment`)
The link, the source, or a follow-up detail. One or two lines.

## Alt text (`altText`)
What the image shows plus any text on it, ≤ 2 sentences.

## Do not
- Engagement bait Facebook explicitly demotes: "Like if you agree", "Share if you…" as a vote, "Tag a friend", "Comment YES", reaction polls (❤️ = A, 😮 = B).
- Fake urgency or scarcity unless the brief states it and it's true.
- Unverifiable claims: guarantees, "the best", "100%". Laws, fees, deadlines only from FACTS, cited in `sources`.
- Links in the caption body, all-caps sentences, walls of hashtags.
- Invented testimonials, customers or reviews.
