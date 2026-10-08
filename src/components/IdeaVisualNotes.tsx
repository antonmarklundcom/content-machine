import { translator, type Locale } from "@/lib/i18n";

/** The shoot/design brief, collapsed by default — the caption is the main event. */
export function IdeaVisualNotes({ notes, locale }: { notes: string | null; locale: Locale }) {
  if (!notes?.trim()) return null;
  const t = translator(locale);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium text-[var(--color-ink)]">
        {t("ideas.visualNotes.title")}
      </summary>
      <p className="mt-1 whitespace-pre-wrap text-[var(--color-ink-muted)]">{notes}</p>
    </details>
  );
}
