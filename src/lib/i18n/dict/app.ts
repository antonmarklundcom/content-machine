/** The shell: app name, language switch, sign-in, error and not-found pages, and the small shared widgets (pagination, result banners). */

export const en = {
  "app.name": "Content Engine",
  "app.title": "YouTube Intelligence Workspace",
  "app.description": "Private research workspace — read digests instead of watching videos.",

  "locale.label": "Language",
  "locale.en": "English",
  "locale.sv": "Svenska",
  "locale.switch": "Switch language",
  "error.topics.title": "Could not load topics",
  "error.marks.title": "Could not load marks",
  "notFound.topic.title": "No such topic",
  "notFound.topic.body":
    "Every topic here is written by an analysis, so one that does not exist was either mistyped or has been retagged away by a newer analysis.",

  "pagination.previous": "← Previous",
  "pagination.next": "Next →",
  "pagination.position": "Page {page} of {total}",

  "result.success": "Done",
  "result.info": "Note",
  "result.error": "Failed",

  "error.eyebrow": "Error",
  "error.digest.title": "The digest could not be loaded",
  "error.video.title": "This analysis could not be loaded",
  "error.sources.title": "Sources could not be loaded",
  "error.ingest.title": "The ingest page could not be loaded",
  "error.retry": "Try again",
  "error.noMessage": "No error message was recorded.",

  "notFound.title": "Page not found",
  "notFound.body": "Nothing lives at this URL.",
  "notFound.video.title": "No such video",
  "notFound.video.body":
    "This video is not in the workspace. It may have been removed, or the link may be wrong.",
  "notFound.back": "Back to the digest",

  "login.title": "Sign in",
  "login.intro": "This workspace is private. Sign in with the account the seed script created.",
  "login.email": "Email",
  "login.password": "Password",
  "login.signIn": "Sign in",
  "login.signingIn": "Signing in…",
  "login.signOut": "Sign out",

  "role.employeeIngestNote":
    "You are signed in as an employee: videos you add are stored, but only the owner can start an analysis.",
} as const;

export const sv: Record<keyof typeof en, string> = {
  "app.name": "Content Engine",
  "app.title": "YouTube-analysarbetsyta",
  "app.description": "Privat researchverktyg — läs sammanfattningar i stället för att titta.",

  "locale.label": "Språk",
  "locale.en": "English",
  "locale.sv": "Svenska",
  "locale.switch": "Byt språk",
  "error.topics.title": "Kunde inte ladda ämnen",
  "error.marks.title": "Kunde inte ladda markeringar",
  "notFound.topic.title": "Ämnet finns inte",
  "notFound.topic.body":
    "Varje ämne här är skrivet av en analys, så ett som inte finns är antingen felstavat eller borttaggat av en nyare analys.",

  "pagination.previous": "← Föregående",
  "pagination.next": "Nästa →",
  "pagination.position": "Sida {page} av {total}",

  "result.success": "Klart",
  "result.info": "Obs",
  "result.error": "Misslyckades",

  "error.eyebrow": "Fel",
  "error.digest.title": "Flödet kunde inte läsas in",
  "error.video.title": "Analysen kunde inte läsas in",
  "error.sources.title": "Källorna kunde inte läsas in",
  "error.ingest.title": "Sidan kunde inte läsas in",
  "error.retry": "Försök igen",
  "error.noMessage": "Inget felmeddelande sparades.",

  "notFound.title": "Sidan hittades inte",
  "notFound.body": "Det finns ingenting på den här adressen.",
  "notFound.video.title": "Videon finns inte",
  "notFound.video.body":
    "Videon finns inte i arbetsytan. Den kan ha tagits bort, eller så är länken fel.",
  "notFound.back": "Tillbaka till flödet",

  "login.title": "Logga in",
  "login.intro": "Den här arbetsytan är privat. Logga in med kontot som seed-skriptet skapade.",
  "login.email": "E-post",
  "login.password": "Lösenord",
  "login.signIn": "Logga in",
  "login.signingIn": "Loggar in…",
  "login.signOut": "Logga ut",

  "role.employeeIngestNote":
    "Du är inloggad som anställd: videor du lägger till sparas, men bara ägaren kan starta en analys.",
};
