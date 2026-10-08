"use client";

import { translator, type Locale } from "@/lib/i18n";
import { createPronunciationAction } from "@/lib/voice.actions";

import { PronunciationForm } from "./PronunciationForm";

/** The "add a respelling" form (new rows start as `proposed`). */
export function PronunciationAddForm({ locale }: { locale: Locale }) {
  return (
    <PronunciationForm
      action={createPronunciationAction}
      locale={locale}
      idPrefix="pron-new"
      submitLabel={translator(locale)("voice.pron.add")}
    />
  );
}
