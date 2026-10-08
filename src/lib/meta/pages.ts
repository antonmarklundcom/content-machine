import type { GraphClient } from "./graph";

/**
 * What a Meta connection can see (PLAN.md §5.O12): the Facebook Pages the user
 * manages and, for each, the Instagram Professional account linked to it. An
 * Instagram account shows up here only when it is Professional AND linked to a
 * Page — the two setup steps the Settings page checks.
 */

export type MetaTarget = {
  pageId: string;
  pageName: string;
  igUserId: string | null;
  igUsername: string | null;
};

type PageRow = {
  id: string;
  name?: string;
  instagram_business_account?: { id: string; username?: string };
};

export async function listMetaTargets(client: GraphClient): Promise<MetaTarget[]> {
  const pages = await client.list<PageRow>(
    "me/accounts",
    { fields: "id,name,instagram_business_account{id,username}", limit: 100 },
    500,
  );
  return pages.map((p) => ({
    pageId: p.id,
    pageName: p.name ?? p.id,
    igUserId: p.instagram_business_account?.id ?? null,
    igUsername: p.instagram_business_account?.username ?? null,
  }));
}

/** A Page's own token (derived from the user token; FB Page insights need it). */
export async function pageToken(client: GraphClient, pageId: string): Promise<string> {
  const row = await client.get<{ access_token?: string }>(pageId, { fields: "access_token" });
  if (!row.access_token) throw new Error(`No Page token for Page ${pageId}.`);
  return row.access_token;
}
