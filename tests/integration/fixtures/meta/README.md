# Meta Graph API fixtures (O12)

Hand-recorded response shapes for Graph API v23.0, used by
`tests/integration/meta-insights.test.ts` through a fake `fetch`. No test calls
Meta. Tokens here are fake (`EAAFAKE…`). The shapes follow Meta's reference for
`oauth/access_token`, `me/accounts`, `{ig-user}/media`, `{ig-media}/insights`,
`{ig-user}/insights` (`metric_type=total_value`), `{page}/posts` and
`{post}/insights`. Live responses were not captured in the build session
(developers.facebook.com is not reachable from it), so the live path is
UNVERIFIED until Anton connects (PLAN.md §7 item 7).
