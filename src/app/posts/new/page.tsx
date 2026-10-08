import Link from "next/link";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { listAccounts, listAllIdeas } from "@/lib/bridge";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { PostNewForm, type NewPostIdea } from "@/components/PostNewForm";

/**
 * `/posts/new` — draft a post for one account from an approved idea or a
 * topic (PLAN.md §6.S15). `?account=` and `?idea=` preselect; `?topic=`
 * prefills. Drafting is O11's engine, called through `createPostAction`.
 */
export default async function NewPostPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const t = translator(await getLocale());
  const params = await searchParams;
  const wantedAccount = Number(params.account);
  const wantedIdea = Number(params.idea);
  const topic = typeof params.topic === "string" ? params.topic.trim().slice(0, 500) : "";

  const accounts = (await listAccounts()).filter((a) => a.status !== "paused");
  // Approved ideas are what a post grows from; an idea asked for by id is
  // offered whatever its status, so a link from the idea board always works.
  const brandIds = [...new Set(accounts.map((a) => a.brandId))];
  const ideas: NewPostIdea[] = (await Promise.all(brandIds.map((id) => listAllIdeas(id))))
    .flat()
    .filter((i) => i.status === "approved" || i.id === wantedIdea)
    .map((i) => ({ id: i.id, brandId: i.brandId, title: i.title, format: i.format }));
  const preselectedIdea = ideas.find((i) => i.id === wantedIdea);
  const account =
    accounts.find((a) => a.id === wantedAccount) ??
    (preselectedIdea ? accounts.find((a) => a.brandId === preselectedIdea.brandId) : undefined) ??
    accounts[0];

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link
        href="/posts"
        className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
      >
        &larr; {t("posts.back")}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">{t("posts.newTitle")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("posts.newIntro")}
      </p>
      {!isOwner(user) && (
        <p className="mt-3 text-sm text-[var(--color-warn)]">{t("posts.ownerOnly")}</p>
      )}
      {accounts.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--color-ink-muted)]">{t("posts.noAccounts")}</p>
      ) : (
        <PostNewForm
          accounts={accounts.map((a) => ({
            id: a.id,
            label: `@${a.handle} · ${a.platform} · ${a.brandName} (${a.effectiveLanguage})`,
            brandId: a.brandId,
          }))}
          ideas={ideas}
          initialAccountId={account!.id}
          initialIdeaId={preselectedIdea?.id ?? null}
          initialTopic={topic}
          canDraft={isOwner(user)}
        />
      )}
    </div>
  );
}
