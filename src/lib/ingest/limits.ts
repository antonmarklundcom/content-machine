/**
 * How many videos one interactive playlist/channel ingest walks.
 *
 * Shared by the form's server action and the streaming route so the two paths
 * can never disagree about how much work a single submit means. Full backfill
 * is `npm run backfill` / the poller, not a form.
 */
export const BULK_INGEST_LIMIT = 25;
