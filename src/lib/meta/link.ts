import "server-only";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { socialAccounts } from "@/db/schema";

import type { MetaTarget } from "./pages";

/**
 * Linking content-engine accounts to Meta (PLAN.md §5.O12): an Instagram
 * account gets its IG user id, a Facebook account its Page id, and both the
 * integration whose token acts for them.
 */

export type LinkPlatform = "instagram" | "facebook";

export async function linkAccount(
  accountId: number,
  link: { externalId: string; integrationId: number },
): Promise<void> {
  const [account] = await db
    .select({ platform: socialAccounts.platform })
    .from(socialAccounts)
    .where(eq(socialAccounts.id, accountId))
    .limit(1);
  if (!account) throw new Error(`No account ${accountId}.`);
  if (account.platform !== "instagram" && account.platform !== "facebook") {
    throw new Error("Only Instagram and Facebook accounts link to Meta.");
  }
  // One content-engine account per Meta id: move the link, never duplicate it.
  await db
    .update(socialAccounts)
    .set({ externalId: null, integrationId: null })
    .where(
      and(
        eq(socialAccounts.platform, account.platform),
        eq(socialAccounts.externalId, link.externalId),
      ),
    );
  await db
    .update(socialAccounts)
    .set({
      externalId: link.externalId,
      integrationId: link.integrationId,
      // Meta only lists Professional IG accounts, so a link proves it.
      ...(account.platform === "instagram" ? { isProfessional: true } : {}),
    })
    .where(eq(socialAccounts.id, accountId));
}

export async function unlinkAccount(accountId: number): Promise<void> {
  await db
    .update(socialAccounts)
    .set({ externalId: null, integrationId: null })
    .where(eq(socialAccounts.id, accountId));
}

const bare = (h: string) => h.replace(/^@/, "").trim().toLowerCase();

/**
 * Link every unlinked IG account whose handle equals a discovered IG username.
 * Facebook Pages have no handle in the API answer, so they are mapped by hand.
 * Returns how many accounts were linked.
 */
export async function autoLinkByHandle(
  targets: MetaTarget[],
  integrationId: number,
): Promise<number> {
  const byUsername = new Map(
    targets
      .filter((t) => t.igUserId && t.igUsername)
      .map((t) => [bare(t.igUsername!), t.igUserId!]),
  );
  if (byUsername.size === 0) return 0;
  const accounts = await db
    .select({
      id: socialAccounts.id,
      handle: socialAccounts.handle,
      externalId: socialAccounts.externalId,
    })
    .from(socialAccounts)
    .where(inArray(socialAccounts.platform, ["instagram"]));
  let linked = 0;
  for (const a of accounts) {
    const igId = byUsername.get(bare(a.handle));
    if (!igId || a.externalId === igId) continue;
    await linkAccount(a.id, { externalId: igId, integrationId });
    linked++;
  }
  return linked;
}
