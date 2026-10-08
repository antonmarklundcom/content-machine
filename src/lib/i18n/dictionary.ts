/**
 * The whole UI's copy, in two languages (PLAN.md §9 PR-22).
 *
 * A flat object and a `t()` helper — deliberately no i18n library and no
 * `[locale]` routing. There are under a hundred strings and exactly one reader;
 * next-intl would add a dependency, a middleware and a routing scheme to solve
 * a problem this file solves in full. Locale lives in a cookie instead, so
 * every URL keeps working and nothing has to be re-linked.
 *
 * `en` is the source of truth: `sv` is typed as a complete map of its keys, so
 * adding an English string without a Swedish one fails typecheck rather than
 * silently rendering a key.
 *
 * Split per feature (PLAN.md §1.26): each `dict/<feature>.ts` owns its strings
 * in both languages, and this file only spreads them. Lane 2's files (brands,
 * ideas, admin) are wired already, so no parallel phase edits this file; a new
 * feature adds one import and its two spreads. `keys.snapshot.json` pins the
 * key set the split started from.
 */

import * as app from "./dict/app";
import * as nav from "./dict/nav";
import * as spend from "./dict/spend";
import * as youtube from "./dict/youtube";
import * as video from "./dict/video";
import * as inbox from "./dict/inbox";
import * as promote from "./dict/promote";
import * as brands from "./dict/brands";
import * as ideas from "./dict/ideas";
import * as admin from "./dict/admin";
import * as research from "./dict/research";
import * as lessons from "./dict/lessons";
import * as scripts from "./dict/scripts";
import * as publish from "./dict/publish";
import * as facts from "./dict/facts";
import * as listing from "./dict/listing";
import * as report from "./dict/report";
import * as settings from "./dict/settings";
import * as header from "./dict/header";
import * as accounts from "./dict/accounts";
import * as media from "./dict/media";
import * as posts from "./dict/posts";
import * as capture from "./dict/capture";
import * as clipFetch from "./dict/clipFetch";
import * as home from "./dict/home";
import * as meta from "./dict/meta";
import * as igCompetitors from "./dict/igCompetitors";
import * as publishNow from "./dict/publishNow";
import * as voice from "./dict/voice";
import * as videoRender from "./dict/videoRender";
import * as stories from "./dict/stories";
import * as glossary from "./dict/glossary";
import * as learn from "./dict/learn";
import * as publishVideo from "./dict/publishVideo";
import * as growth from "./dict/growth";
import * as higgsfield from "./dict/higgsfield";
import * as pcOnly from "./dict/pcOnly";
import * as hfVoice from "./dict/hfVoice";
import * as record from "./dict/record";
import * as dataset from "./dict/dataset";
import * as chatterbox from "./dict/chatterbox";

export const en = {
  ...app.en,
  ...nav.en,
  ...spend.en,
  ...youtube.en,
  ...video.en,
  ...inbox.en,
  ...promote.en,
  ...brands.en,
  ...ideas.en,
  ...admin.en,
  ...research.en,
  ...lessons.en,
  ...scripts.en,
  ...publish.en,
  ...facts.en,
  ...listing.en,
  ...report.en,
  ...settings.en,
  ...header.en,
  ...accounts.en,
  ...media.en,
  ...posts.en,
  ...capture.en,
  ...clipFetch.en,
  ...home.en,
  ...meta.en,
  ...igCompetitors.en,
  ...publishNow.en,
  ...voice.en,
  ...videoRender.en,
  ...stories.en,
  ...glossary.en,
  ...learn.en,
  ...publishVideo.en,
  ...growth.en,
  ...higgsfield.en,
  ...pcOnly.en,
  ...hfVoice.en,
  ...record.en,
  ...dataset.en,
  ...chatterbox.en,
} as const;

export type TranslationKey = keyof typeof en;

export const sv: Record<TranslationKey, string> = {
  ...app.sv,
  ...nav.sv,
  ...spend.sv,
  ...youtube.sv,
  ...video.sv,
  ...inbox.sv,
  ...promote.sv,
  ...brands.sv,
  ...ideas.sv,
  ...admin.sv,
  ...research.sv,
  ...lessons.sv,
  ...scripts.sv,
  ...publish.sv,
  ...facts.sv,
  ...listing.sv,
  ...report.sv,
  ...settings.sv,
  ...header.sv,
  ...accounts.sv,
  ...media.sv,
  ...posts.sv,
  ...capture.sv,
  ...clipFetch.sv,
  ...home.sv,
  ...meta.sv,
  ...igCompetitors.sv,
  ...publishNow.sv,
  ...voice.sv,
  ...videoRender.sv,
  ...stories.sv,
  ...glossary.sv,
  ...learn.sv,
  ...publishVideo.sv,
  ...growth.sv,
  ...higgsfield.sv,
  ...pcOnly.sv,
  ...hfVoice.sv,
  ...record.sv,
  ...dataset.sv,
  ...chatterbox.sv,
};

export const DICTIONARIES = { en, sv } as const;
