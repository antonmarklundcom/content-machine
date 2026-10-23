/** Telegram capture and the inbox's brand/purpose/tag filters (PLAN.md §6.S16). */

export const en = {
  "capture.error.expired": "Your session expired. Your text is still here.",
  "capture.signInRetry": "Sign in in a new tab, then retry here (opens a new tab).",
  "capture.error.network":
    "The connection was interrupted. Your link and note are still here. Retry to confirm the save.",
  "capture.error.receipt":
    "The save could not be confirmed. Your link and note are still here. Retry to confirm the save.",
  "capture.duplicate.unchanged": "Already in your inbox. Nothing new was created.",
  "capture.duplicate.note":
    "Already in your inbox. Nothing new was created; your note replaced the earlier one.",
  "capture.duplicate.otherPurpose":
    "Already in your inbox as {purpose}. Nothing new was created and it was not moved; change its purpose in the inbox if needed.",
  "capture.duplicate.otherPurposeNote":
    "Already in your inbox as {purpose}. Your note replaced the earlier one; it was not moved. Change its purpose in the inbox if needed.",
  "capture.title": "Capture",
  "capture.filter.allBrands": "All brands",
  "capture.filter.allPurposes": "All purposes",
  "capture.filter.tag": "Tag",
  "capture.filter.tagPlaceholder": "tag",
  "capture.purpose.inspo": "Inspo",
  "capture.purpose.competitor": "Competitor",
  "capture.purpose.fact_check": "Fact-check",
  "capture.purpose.own": "Own",
  "capture.purpose.learn": "Learn",
  "capture.purpose.other": "No purpose",
  "capture.source.share": "share sheet",
  "capture.source.shortcut": "Shortcut",
  "capture.source.telegram": "Telegram",
  "capture.source.web": "web",
  "capture.noBrand": "No brand",
  "capture.brand": "Brand",
  "capture.purpose": "Purpose",
  "capture.tags": "Tags",
  "capture.tagsPlaceholder": "visa, pricing",
  "capture.edit": "Edit tags",
  "capture.save": "Save",
  "capture.hashtagHint":
    "Tip: #brand #inspo #competitor #factcheck #own and any #tag in the note work too.",
  "capture.telegram.title": "Telegram",
  "capture.telegram.body":
    "Send links to your Telegram bot from anywhere, even with the PC off. Setup: workers/telegram-capture/README.md.",
} as const;

export const sv: Record<keyof typeof en, string> = {
  "capture.error.expired": "Din session har gått ut. Din text finns kvar här.",
  "capture.signInRetry": "Logga in i en ny flik och försök igen här (öppnas i en ny flik).",
  "capture.error.network":
    "Anslutningen avbröts. Din länk och notering finns kvar. Försök igen för att bekräfta att det sparats.",
  "capture.error.receipt":
    "Det gick inte att bekräfta att länken sparats. Din länk och notering finns kvar. Försök igen för att bekräfta.",
  "capture.duplicate.unchanged": "Finns redan i inkorgen. Inget nytt skapades.",
  "capture.duplicate.note":
    "Finns redan i inkorgen. Inget nytt skapades; din anteckning ersatte den tidigare.",
  "capture.duplicate.otherPurpose":
    "Finns redan i inkorgen som {purpose}. Inget nytt skapades och den flyttades inte; ändra syftet i inkorgen vid behov.",
  "capture.duplicate.otherPurposeNote":
    "Finns redan i inkorgen som {purpose}. Din anteckning ersatte den tidigare; den flyttades inte. Ändra syftet i inkorgen vid behov.",
  "capture.title": "Fånga",
  "capture.filter.allBrands": "Alla varumärken",
  "capture.filter.allPurposes": "Alla syften",
  "capture.filter.tag": "Tagg",
  "capture.filter.tagPlaceholder": "tagg",
  "capture.purpose.inspo": "Inspiration",
  "capture.purpose.competitor": "Konkurrent",
  "capture.purpose.fact_check": "Faktakoll",
  "capture.purpose.own": "Eget",
  "capture.purpose.learn": "Lära",
  "capture.purpose.other": "Inget syfte",
  "capture.source.share": "delningsmeny",
  "capture.source.shortcut": "Genväg",
  "capture.source.telegram": "Telegram",
  "capture.source.web": "webb",
  "capture.noBrand": "Inget varumärke",
  "capture.brand": "Varumärke",
  "capture.purpose": "Syfte",
  "capture.tags": "Taggar",
  "capture.tagsPlaceholder": "visum, priser",
  "capture.edit": "Redigera taggar",
  "capture.save": "Spara",
  "capture.hashtagHint":
    "Tips: #varumärke #inspo #competitor #factcheck #own och valfri #tagg i noteringen fungerar också.",
  "capture.telegram.title": "Telegram",
  "capture.telegram.body":
    "Skicka länkar till din Telegram-bot var du än är, även när datorn är av. Inställning: workers/telegram-capture/README.md.",
};
