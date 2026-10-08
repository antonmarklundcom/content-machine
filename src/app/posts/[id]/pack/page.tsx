import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getPost } from "@/lib/bridge";
import { exportPack, PostEngineError } from "@/lib/posts/engine";
import type { PostPack as PackData } from "@/lib/posts/export";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { PostPack } from "@/components/PostPack";
import { FORMAT_LABEL, STATUS_LABEL, statusTone } from "../../model";

/**
 * `/posts/[id]/pack` — the phone post pack (PLAN.md §1.49, §6.S15): one big
 * "Copy caption", the files in order with download links, then "Mark posted"
 * with the permalink. Built for a 375px screen: one column, full-width
 * buttons, nothing to scroll sideways.
 */
export default async function PostPackPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const t = translator(await getLocale());
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const post = await getPost(id);
  if (!post) notFound();

  let pack: PackData | null = null;
  try {
    pack = (await exportPack(id)).json;
  } catch (error) {
    if (!(error instanceof PostEngineError)) throw error;
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6">
      <Link
        href={`/posts/${id}`}
        className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
      >
        &larr; {t("posts.pack.editor")}
      </Link>
      <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
        <span className={`font-medium ${statusTone(post.status)}`}>
          {t(STATUS_LABEL[post.status])}
        </span>
        {" · "}
        {t(FORMAT_LABEL[post.format])}
        {post.platform ? ` · ${post.platform}` : ""}
      </p>
      <h1 className="mt-1 text-xl font-semibold break-words text-[var(--color-ink)]">
        {post.handle ? `@${post.handle}` : post.title || t("posts.pack.title")}
      </h1>
      {pack ? (
        <PostPack
          pack={pack}
          status={post.status}
          permalink={post.permalink}
          scheduledFor={post.scheduledFor?.toISOString() ?? null}
        />
      ) : (
        <p className="mt-6 text-sm text-[var(--color-warn)]">{t("posts.pack.noDraft")}</p>
      )}
    </div>
  );
}
