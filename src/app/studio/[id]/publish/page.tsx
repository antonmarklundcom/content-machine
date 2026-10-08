import Link from "next/link";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { validatePublishPack } from "@/lib/studio/pack";
import { PublishPackEditor } from "@/components/PublishPackEditor";
import { PublishUrlForm } from "@/components/PublishUrlForm";
import { STATUS_LABEL } from "../../model";
import { loadScript } from "../load";

/** `/studio/[id]/publish` — the YouTube URL and the post-recording pack (build 2b, idea 6). */
export default async function PublishPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const t = translator(await getLocale());
  const { row, valid } = await loadScript((await params).id);
  const stored = row.publishPack ? validatePublishPack(row.publishPack) : null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link
        href={`/studio/${row.id}`}
        className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
      >
        &larr; {t("publish.back")}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">
        {t("publish.pack.title")} · {row.title}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t(STATUS_LABEL[row.status])}</p>

      <div className="surface-border surface-card mt-6 px-5 py-4">
        <PublishUrlForm scriptId={row.id} initialUrl={row.youtubeUrl ?? ""} />
      </div>

      <div className="mt-6">
        {valid ? (
          <PublishPackEditor
            scriptId={row.id}
            initialPack={stored?.ok ? stored.pack : null}
            canGenerate={isOwner(user)}
          />
        ) : (
          <p className="text-sm text-[var(--color-danger)]">{t("studio.editor.unreadable")}</p>
        )}
      </div>
    </div>
  );
}
