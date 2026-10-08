/** Owned by S10 (competitor research, PLAN.md §6.S10). */

export const en = {
  "research.eyebrow": "Research",
  "research.title": "Competitor research",
  "research.intro":
    "Channels each brand studies, and the videos that beat their own channel's median views.",
  "research.brand": "Brand",
  "research.noBrands": "No active brands yet. Add one to the brands table, then come back here.",

  "research.channels": "Channels",
  "research.addPlaceholder": "Paste a competitor's channel URL",
  "research.add": "Add channel",
  "research.adding": "Adding…",
  "research.added": "Channel added. Its videos arrive on the next poll (npm run yt:poll).",
  "research.channelsEmpty":
    "No channels yet. Paste a competitor's channel URL above to start tracking it.",
  "research.role.competitor": "Competitor",
  "research.role.inspiration": "Inspiration",
  "research.role.own": "My channel",
  "research.roleLabel": "Role",
  "research.remove": "Remove",
  "research.removeConfirm":
    "Stop studying this channel for this brand? The channel and its videos stay tracked.",
  "research.channelStats": "{videos} videos · {analysed} analysed",
  "research.median": "median {views} views",
  "research.noMedian": "fewer than 5 videos, no score yet",

  "research.outliers": "Outlier board",
  "research.outliersNote": "Views ÷ the channel's median over its last 30 videos.",
  "research.window": "Published in the last",
  "research.days": "{days} days",
  "research.outliersEmpty":
    "No outliers in this window. Add channels, run the poll (npm run yt:poll), or widen the window.",
  "research.views": "{views} views",
  "research.score": "{score}× median",
  "research.analyse": "Analyse",
  "research.analysing": "Analysing…",
  "research.openDigest": "Open digest",
  "research.useAsReference": "Use as reference",
  "research.notAnalysed": "Not analysed yet.",

  "research.titlePatterns": "Title patterns",
  "research.titlePatternsNote": "The outliers' titles side by side — copy them into a brief.",
  "research.copyTitles": "Copy titles",
  "research.titlePatternsEmpty": "Titles appear here once the board has outliers.",

  "research.error.brand": "That brand does not exist.",
  "research.error.url": "Paste a channel URL, e.g. https://www.youtube.com/@name.",
  "research.error.notChannel": "That is a video or playlist. Paste the channel's URL instead.",
  "research.error.notFound": "YouTube returned no such channel.",
  "research.error.role": "Unknown role.",
  "research.error.failed": "Could not add the channel.",
} as const;

export const sv: Record<keyof typeof en, string> = {
  "research.eyebrow": "Research",
  "research.title": "Konkurrentanalys",
  "research.intro":
    "Kanaler varje varumärke studerar, och videorna som slår kanalens egen medianvisning.",
  "research.brand": "Varumärke",
  "research.noBrands":
    "Inga aktiva varumärken än. Lägg till ett i brands-tabellen och kom tillbaka.",

  "research.channels": "Kanaler",
  "research.addPlaceholder": "Klistra in en konkurrents kanal-URL",
  "research.add": "Lägg till kanal",
  "research.adding": "Lägger till…",
  "research.added": "Kanalen är tillagd. Videorna kommer vid nästa hämtning (npm run yt:poll).",
  "research.channelsEmpty":
    "Inga kanaler än. Klistra in en konkurrents kanal-URL ovan för att börja följa den.",
  "research.role.competitor": "Konkurrent",
  "research.role.inspiration": "Inspiration",
  "research.role.own": "Min kanal",
  "research.roleLabel": "Roll",
  "research.remove": "Ta bort",
  "research.removeConfirm":
    "Sluta studera kanalen för det här varumärket? Kanalen och dess videor följs fortfarande.",
  "research.channelStats": "{videos} videor · {analysed} analyserade",
  "research.median": "median {views} visningar",
  "research.noMedian": "färre än 5 videor, ingen poäng än",

  "research.outliers": "Utstickare",
  "research.outliersNote": "Visningar ÷ kanalens median för de senaste 30 videorna.",
  "research.window": "Publicerade de senaste",
  "research.days": "{days} dagarna",
  "research.outliersEmpty":
    "Inga utstickare i perioden. Lägg till kanaler, kör hämtningen (npm run yt:poll) eller välj en längre period.",
  "research.views": "{views} visningar",
  "research.score": "{score}× median",
  "research.analyse": "Analysera",
  "research.analysing": "Analyserar…",
  "research.openDigest": "Öppna sammanfattning",
  "research.useAsReference": "Använd som referens",
  "research.notAnalysed": "Inte analyserad än.",

  "research.titlePatterns": "Titelmönster",
  "research.titlePatternsNote": "Utstickarnas titlar sida vid sida — kopiera dem till en brief.",
  "research.copyTitles": "Kopiera titlar",
  "research.titlePatternsEmpty": "Titlarna visas här när tavlan har utstickare.",

  "research.error.brand": "Varumärket finns inte.",
  "research.error.url": "Klistra in en kanal-URL, t.ex. https://www.youtube.com/@namn.",
  "research.error.notChannel":
    "Det är en video eller spellista. Klistra in kanalens URL i stället.",
  "research.error.notFound": "YouTube hittade ingen sådan kanal.",
  "research.error.role": "Okänd roll.",
  "research.error.failed": "Kunde inte lägga till kanalen.",
};
