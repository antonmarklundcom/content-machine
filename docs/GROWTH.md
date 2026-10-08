# Growth: comment replies, content gaps, results, lead links

Build 4 phase G. Four tools that turn published posts into conversations,
next topics and leads. None of them posts anything on your behalf.

## Comment replies — `/comments`

1. `npm run comments:sync` reads Instagram comments on posts published in the
   last 14 days (`--days N` to change) for every linked **professional**
   Instagram account (Settings → Meta). It uses the same Meta login as
   `meta:sync`; reading comments needs the `instagram_manage_comments`
   permission on that login.
2. Comments and replies by other people are stored once each (by comment id);
   the account's own comments are skipped, and a comment the account already
   answered on Instagram arrives as **Replied**.
3. **Draft reply** (owner, spends a little) writes a suggestion in the
   account's language, following `content/style/<language>.md` (voseo for
   `es-PY`), the brand kit's CTAs and do/don't, the post's caption and the
   brand's fact sheet — verified facts as facts, unverified ones only hedged.
   Questions about prices, fees, legal or tax matters, or the commenter's own
   case are marked **Needs you**: the draft is a friendly holding reply and the
   answer is yours to give.
4. Edit, **Approve**, **Copy**, open the comment, reply on Instagram, then
   **Mark replied** (or **Dismiss**). Nothing is ever sent automatically.

`npm run comments:sync -- --draft` drafts the new ones right after syncing
(at most 50 per run; `--limit N`).

## Content gaps — `/research/gaps?brand=<id>`

Gathers the last 90 days of tracked competitors' posts (Research → Instagram),
the latest competitor reports, open audience questions, and what the brand
already published, planned (ideas) or scripted. **Find gaps** (owner; the
page shows the most it can cost) asks for 5–10 topics others cover and the
brand does not, each with a score 1–10 and evidence. Evidence must point at
real inputs — a gap the model cannot back up is dropped. **Make idea** turns a
gap into a proposed idea on the brand's idea board; **Dismiss** hides it.

`npm run gaps:find [-- --brand <id>] [-- --dry]` does the same from a terminal.

## Results — `/results`

Read-only, per brand and account, default the last 90 days. Every published
post with its **newest** insights snapshot (`npm run meta:sync` fills them),
totals, a followers sparkline per account, the top 10 posts, and tables by
format, account, language, engagement mechanic and hook shape.

**Engagement rate** = (saves + shares + comments) ÷ reach, per post, the same
rate "what worked" uses when drafting posts. Group rates are the mean of the
post rates. Likes are shown but not counted. Posts without reach are counted
but not rated.

## Lead links and VenderCRM

Each brand kit has a **lead base URL**: where post CTAs send people. Point it
at the brand's **VenderCRM form or landing page** (the page whose form posts
to VenderCRM's `/api/v1/leads`). Each post gets a lead link built from it:

```
<base>?utm_source=<platform>&utm_medium=social&utm_campaign=<campaign or handle>&utm_content=post-<id>
```

Parameters already on the base (including any `utm_*` you set there) and its
`#fragment` are kept as they are. When the landing page passes the page's UTM
parameters into the lead it submits, every lead in VenderCRM shows which
platform, account and post it came from — so `/results` (engagement) and
VenderCRM (leads) can be read side by side per post.

In the post editor, **Fill from kit** builds the link (optional campaign
name); it can also be typed or cleared by hand. Put the link in the bio, a
story link sticker, or the first comment.
