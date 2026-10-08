import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { isPureGuarani, loadApprovedJoparaTerms } from "@/lib/glossary/prompt";
import { findUnapprovedGuarani } from "@/lib/glossary/warnings";

/** Languages whose text may carry everyday Guaraní words and so gets checked. */
function isChecked(language: string): boolean {
  const tag = language.trim().toLowerCase();
  return tag === "jopara" || tag === "es" || tag.startsWith("es-");
}

/**
 * Server component: lists Guaraní-looking words in `text` that are neither
 * approved + Jopará-ok in /glossary nor on the safe list (build 4 §1.2).
 * For `gn` it reminds that the text needs a native speaker's review.
 * Renders nothing when there is nothing to say.
 */
export async function GlossaryWarnings({ text, language }: { text: string; language: string }) {
  const t = translator(await getLocale());
  if (isPureGuarani(language)) {
    return (
      <p className="surface-border rounded-[var(--radius-sm)] border-[var(--color-danger)] p-3 text-xs text-[var(--color-danger)]">
        {t("glossary.warnings.gn")}
      </p>
    );
  }
  if (!isChecked(language) || !text.trim()) return null;
  const approved = (await loadApprovedJoparaTerms()).map((a) => a.term);
  const warnings = findUnapprovedGuarani(text, approved);
  if (warnings.length === 0) return null;
  const words = [...new Set(warnings.map((w) => w.word))];
  return (
    <div className="surface-border rounded-[var(--radius-sm)] border-[var(--color-danger)] p-3 text-xs">
      <p className="font-medium text-[var(--color-danger)]">
        {t("glossary.warnings.title", { count: words.length })}
      </p>
      <p className="mt-1 text-[var(--color-ink)]">{words.join(", ")}</p>
      <p className="mt-1 text-[var(--color-ink-muted)]">
        {t("glossary.warnings.hint")}{" "}
        <a href="/glossary" className="text-[var(--color-accent)] hover:underline">
          /glossary
        </a>
      </p>
    </div>
  );
}
