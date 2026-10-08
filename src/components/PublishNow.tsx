import { getAccount, type PostWithAccount } from "@/lib/bridge";
import { PUBLISHABLE_PLATFORMS } from "@/lib/publish/plan";
import { PublishNowButton } from "./PublishNowButton";

/**
 * The post page's publish box (PLAN.md §5.O13), owner-only where it is
 * mounted. Server half: whether the post's account is linked to Meta.
 */
export async function PublishNow({ post }: { post: PostWithAccount }) {
  const account = await getAccount(post.accountId);
  const platform = account?.platform ?? post.platform ?? "instagram";
  return (
    <section className="surface-border surface-card px-5 py-4">
      <PublishNowButton
        postId={post.id}
        revision={post.revision}
        blocked={Boolean(
          post.externalMediaId ||
          post.publishedAt ||
          post.publishState === "ambiguous" ||
          post.publishState === "confirmed",
        )}
        canStop={Boolean(
          post.publishAttemptId &&
          !post.externalMediaId &&
          post.publishState !== "confirmed" &&
          post.publishState !== "ambiguous" &&
          ["publishing", "failed"].includes(post.status),
        )}
        status={post.status}
        handle={account?.handle ?? post.handle ?? ""}
        platform={platform}
        supported={PUBLISHABLE_PLATFORMS.includes(platform)}
        linked={Boolean(account?.externalId && account.integrationId)}
        resumable={post.externalContainerId !== null}
        lastError={post.publishError}
      />
    </section>
  );
}
