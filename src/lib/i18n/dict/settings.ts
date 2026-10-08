/** Settings page: API keys and AI provider, saved to the local `.env` (local mode). */

export const en = {
  "settings.eyebrow": "Setup",
  "settings.title": "Settings",
  "settings.intro":
    "Keys are saved to the .env file on this computer. They never leave it except to call the service they belong to.",
  "settings.localOnly":
    "Settings can only be changed when the app runs on this computer (localhost). Edit the server's environment variables instead.",
  "settings.ownerOnly": "Only the owner can change settings.",
  "settings.set": "Set",
  "settings.notSet": "Not set",
  "settings.required": "Needed",
  "settings.optional": "Optional",
  "settings.getIt": "Get it",
  "settings.placeholderKeep": "Leave empty to keep the current value",
  "settings.save": "Save",
  "settings.saving": "Saving…",
  "settings.saved":
    "Saved. Keys are active now; if something still says a key is missing, restart the app (close the window and run start.bat).",
  "settings.test": "Test",
  "settings.testing": "Testing…",
  "settings.clear": "Remove",
  "settings.database": "Database",
  "settings.databaseNote":
    "Set by the installer. Changing it means a different database, so it is not editable here.",
  "settings.error": "Could not save: {detail}",
} as const;

export const sv: Record<keyof typeof en, string> = {
  "settings.eyebrow": "Installation",
  "settings.title": "Inställningar",
  "settings.intro":
    "Nycklarna sparas i .env-filen på den här datorn. De lämnar den bara för att anropa tjänsten de hör till.",
  "settings.localOnly":
    "Inställningar kan bara ändras när appen körs på den här datorn (localhost). Ändra serverns miljövariabler i stället.",
  "settings.ownerOnly": "Bara ägaren kan ändra inställningar.",
  "settings.set": "Satt",
  "settings.notSet": "Inte satt",
  "settings.required": "Behövs",
  "settings.optional": "Valfri",
  "settings.getIt": "Hämta",
  "settings.placeholderKeep": "Lämna tomt för att behålla nuvarande värde",
  "settings.save": "Spara",
  "settings.saving": "Sparar…",
  "settings.saved":
    "Sparat. Nycklarna gäller nu; om något fortfarande säger att en nyckel saknas, starta om appen (stäng fönstret och kör start.bat).",
  "settings.test": "Testa",
  "settings.testing": "Testar…",
  "settings.clear": "Ta bort",
  "settings.database": "Databas",
  "settings.databaseNote":
    "Sattes av installationen. Att ändra den betyder en annan databas, så den går inte att ändra här.",
  "settings.error": "Kunde inte spara: {detail}",
};
