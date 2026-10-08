/** Turning a clip or an analysis into an idea: promote, post formats, and seeding ideas from a video. */

export const en = {
  "promote.trigger": "Promote",
  "promote.title": "Promote to an idea",
  "promote.source": "What to promote",
  "promote.brand": "Brand",
  "promote.format": "Format",
  "promote.platform": "Platform",
  "promote.adapt": "Adapt copy to the brand's voice",
  "promote.adaptHint":
    "Spends a small amount on one model call. Off promotes the text verbatim, for free.",
  "promote.submit": "Promote",
  "promote.submitting": "Promoting…",
  "promote.success": "Promoted.",
  "promote.viewBrand": "View on the brand's page ↗",
  "promote.noIdeas": "This analysis has no ideas to promote yet.",
  "promote.noAnalysis": "Not analysed yet — nothing to promote.",

  "format.reel": "Reel",
  "format.carousel": "Carousel",
  "format.image_post": "Image post",
  "format.story": "Story",

  "seed.trigger": "Seed from a video",
  "seed.title": "Seed ideas from an analysed video",
  "seed.video": "Video",
  "seed.submit": "Generate ideas",
  "seed.submitting": "Researching + writing…",
  "seed.none": "No analysed videos yet — analyse one in the YouTube tool first.",
} as const;

export const sv: Record<keyof typeof en, string> = {
  "promote.trigger": "Befordra",
  "promote.title": "Befordra till en idé",
  "promote.source": "Vad ska befordras",
  "promote.brand": "Varumärke",
  "promote.format": "Format",
  "promote.platform": "Plattform",
  "promote.adapt": "Anpassa texten till varumärkets röst",
  "promote.adaptHint":
    "Kostar en liten summa för ett modellanrop. Av befordrar texten ordagrant, gratis.",
  "promote.submit": "Befordra",
  "promote.submitting": "Befordrar…",
  "promote.success": "Befordrad.",
  "promote.viewBrand": "Visa på varumärkets sida ↗",
  "promote.noIdeas": "Den här analysen har inga idéer att befordra ännu.",
  "promote.noAnalysis": "Inte analyserad ännu — inget att befordra.",

  "format.reel": "Reel",
  "format.carousel": "Karusell",
  "format.image_post": "Bildinlägg",
  "format.story": "Story",

  "seed.trigger": "Så från en video",
  "seed.title": "Så idéer från en analyserad video",
  "seed.video": "Video",
  "seed.submit": "Generera idéer",
  "seed.submitting": "Researchar och skriver…",
  "seed.none": "Inga analyserade videor än — analysera en i YouTube-verktyget först.",
};
