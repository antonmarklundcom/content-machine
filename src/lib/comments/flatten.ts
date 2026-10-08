/**
 * Instagram comments as the Graph API returns them
 * (`/{ig-media-id}/comments?fields=id,text,username,timestamp,replies{…}`),
 * flattened into the rows `comment_drafts` stores. Pure.
 */

export type IgCommentReply = {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
};

export type IgComment = IgCommentReply & {
  replies?: { data?: IgCommentReply[] };
};

export const IG_COMMENT_FIELDS = "id,text,username,timestamp,replies{id,text,username,timestamp}";

export type FlatComment = {
  externalCommentId: string;
  author: string | null;
  text: string;
  commentedAt: Date | null;
  /** True when the account itself already answered in this thread, after this comment. */
  answered: boolean;
};

const norm = (handle: string | undefined | null) =>
  (handle ?? "").trim().replace(/^@+/, "").toLowerCase();

function when(ts: string | undefined): Date | null {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Every comment and reply by someone other than `ownHandle`, oldest first.
 * The account's own comments and replies are skipped; a comment the account
 * already replied to (an own reply later in the same thread) is `answered`.
 * Empty texts are skipped — there is nothing to answer.
 */
export function flattenComments(comments: IgComment[], ownHandle: string): FlatComment[] {
  const own = norm(ownHandle);
  const out: FlatComment[] = [];
  for (const c of comments) {
    const replies = c.replies?.data ?? [];
    const ownReplyTimes = replies
      .filter((r) => norm(r.username) === own)
      .map((r) => when(r.timestamp)?.getTime() ?? Number.POSITIVE_INFINITY);
    const answeredAfter = (at: Date | null) =>
      ownReplyTimes.some((t) => at === null || t >= at.getTime());

    const thread: IgCommentReply[] = [c, ...replies];
    for (const item of thread) {
      if (!item.id || norm(item.username) === own) continue;
      const text = (item.text ?? "").trim();
      if (!text) continue;
      const at = when(item.timestamp);
      out.push({
        externalCommentId: item.id,
        author: item.username ? item.username.slice(0, 255) : null,
        text,
        commentedAt: at,
        answered: answeredAfter(at),
      });
    }
  }
  return out.sort((a, b) => (a.commentedAt?.getTime() ?? 0) - (b.commentedAt?.getTime() ?? 0));
}

/**
 * A link that opens the comment on instagram.com: the post permalink plus
 * `c/<comment id>/`. The format is Instagram's web URL, not an API field —
 * UNVERIFIED live; it falls back to the post permalink where it does not work.
 */
export function commentPermalink(postPermalink: string | null, commentId: string): string | null {
  if (!postPermalink) return null;
  try {
    const url = new URL(postPermalink);
    if (!/(^|\.)instagram\.com$/.test(url.hostname)) return postPermalink;
    const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    return `${url.origin}${path}c/${encodeURIComponent(commentId)}/`;
  } catch {
    return null;
  }
}
