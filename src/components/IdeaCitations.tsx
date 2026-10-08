import { translator, type Locale } from "@/lib/i18n";

// Model-written JSON: `sources` is typed as an array but is not guaranteed one.
type Citation = { claim: string; sources?: string[] | null };

/** Only http(s) URLs become links; anything else a model wrote stays text. */
function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** An idea's citations: each claim, with its sources as links (PLAN.md §6.S6). */
export function IdeaCitations({
  citations,
  locale,
}: {
  citations: Citation[] | null;
  locale: Locale;
}) {
  if (!citations?.length) return null;
  const t = translator(locale);
  return (
    <div className="text-sm">
      <p className="font-medium text-[var(--color-ink)]">{t("ideas.citations.title")}</p>
      <ul className="mt-1 space-y-1 text-[var(--color-ink-muted)]">
        {citations.map((citation, i) => (
          <li key={i}>
            <span>{citation.claim}</span>{" "}
            {(citation.sources ?? []).map((source, j) =>
              isWebUrl(source) ? (
                <a
                  key={j}
                  href={source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mr-2 break-all text-[var(--color-accent)] underline"
                >
                  {new URL(source).hostname.replace(/^www\./, "")}
                </a>
              ) : (
                <span key={j} className="mr-2 break-all">
                  {source}
                </span>
              ),
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
