"use client";

import { createFactAction } from "@/lib/facts.actions";
import type { Locale } from "@/lib/i18n";
import { translator } from "@/lib/i18n";
import { FactForm } from "./FactForm";

/** The "add a fact" form for one brand's sheet. */
export function FactAddForm({
  brandId,
  topics,
  locale,
}: {
  brandId: string;
  topics: string[];
  locale: Locale;
}) {
  return (
    <FactForm
      action={createFactAction.bind(null, brandId)}
      topics={topics}
      locale={locale}
      idPrefix="fact-new"
      submitLabel={translator(locale)("facts.add")}
    />
  );
}
