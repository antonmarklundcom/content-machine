import Link from "next/link";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { latestScriptDerivatives } from "@/lib/bridge/derivatives";
import { getScript, listChildScripts } from "@/lib/bridge/scripts";
import { formatDate } from "@/lib/format";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { RepurposeProsePanel } from "@/components/RepurposeProsePanel";
import { RepurposeShortsButton } from "@/components/RepurposeShortsButton";
import { STATUS_LABEL } from "../../model";
import { loadScript } from "../load";

/** `/studio/[id]/repurpose` — shorts, blog post and newsletter blurb from one script (build 2b, idea 7). */
export default async function RepurposePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const t = translator(locale);
  const { row, valid } = await loadScript((await params).id);
  const [children, latest, parent] = await Promise.all([
    listChildScripts(row.id),
    latestScriptDerivatives(row.id),
    row.parentScriptId ? getScript(row.parentScriptId) : Promise.resolve(null),
  ]);
  const owner = isOwner(user);
  const slug =
    row.title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || `script-${row.id}`;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link
        href={`/studio/${row.id}`}
        className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
      >
        &larr; {t("publish.back")}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
        {t("publish.repurpose.title")} · {row.title}
      </h1>
      {parent && (
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          <Link href={`/studio/${parent.id}`} className="hover:text-[var(--color-accent)]">
            {t("publish.repurpose.parent", { title: parent.title })}
          </Link>
        </p>
      )}
      {!valid && (
        <p className="mt-4 text-sm text-[var(--color-danger)]">{t("studio.editor.unreadable")}</p>
      )}
      {!owner && (
        <p className="mt-4 text-xs text-[var(--color-ink-muted)]">{t("publish.ownerOnly")}</p>
      )}

      <section className="surface-border surface-card mt-6 flex flex-col gap-3 px-5 py-4">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">
          {t("publish.repurpose.shorts")}
        </h2>
        <p className="text-xs text-[var(--color-ink-muted)]">{t("publish.repurpose.shortsHelp")}</p>
        {owner && valid && <RepurposeShortsButton scriptId={row.id} />}
        <h3 className="mt-2 text-xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
          {t("publish.repurpose.existing")}
        </h3>
        {children.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">{t("publish.repurpose.noShorts")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {children.map((c) => (
              <li key={c.id} className="text-sm">
                <Link
                  href={`/studio/${c.id}`}
                  className="text-[var(--color-ink)] hover:text-[var(--color-accent)]"
                >
                  {c.title}
                </Link>
                <span className="text-xs text-[var(--color-ink-muted)]">
                  {" "}
                  · {t(STATUS_LABEL[c.status])} · {formatDate(c.createdAt, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(["blog", "newsletter"] as const).map((kind) => {
        const d = latest[kind];
        return (
          <RepurposeProsePanel
            key={kind}
            scriptId={row.id}
            kind={kind}
            canGenerate={owner && valid}
            initial={d ? { content: d.content, writtenAt: formatDate(d.createdAt, locale) } : null}
            filename={`${slug}-${kind}.md`}
          />
        );
      })}
    </div>
  );
}
