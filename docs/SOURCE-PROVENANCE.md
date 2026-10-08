# Source provenance

Imported **1139 tracked files only** from Content Engine commit `4c8c735880ffa45810997b7c778163ec78e5d89e`, 2026-10-08, canonical checkout C:/Projects/content-engine on codex/fix-audit-bugs. Its HEAD and clean tracked worktree were verified unchanged after conversion. Other existing source checkouts and their uncommitted work were not moved or edited.

The new repository's main began with the written conversion plan at `5a29144` before tracked-source import. Conversion changes are one cohesive PR with focused commits: [PR #1](https://github.com/antonmarklundcom/content-machine/pull/1). Original Git history remains in content-engine; it was not rewritten/imported. Ignored environment values, real databases/backups, media libraries and installed dependencies were not copied. No online data existed to move.

Inherited BUG-01…15 fixes remain in the source baseline. BUG-16…22 were independently traced and corrected as CM-BUG-01…07; CM-BUG-08…27 record additional defects found during conversion. Published dependency advisory remediation is tracked separately as CM-SEC-01…03. [Findings](CONVERSION-FINDINGS.md) contain current file/line evidence and regression checks; [completion report](CONVERSION-REPORT.md) records verified coverage and owner actions.

Active runtime: mysql2 + Drizzle MySQL/MariaDB; active migration folder drizzle-mysql. Root drizzle/ PostgreSQL migrations and earlier phase reports are inactive historical provenance. The pg development dependency exists only for an optional one-time, read-only aiinsights source import; there is no PostgreSQL/Neon app runtime fallback.

Code verification: `8025fd7924ed80e8dabb9c6956622c81317a6c6f`, [verified code run](https://github.com/antonmarklundcom/content-machine/actions/runs/37854603317); no deployment, live provider purchase/generation, social send, connected-account change or task installation occurred. A later Hostinger installation requires owner database/login/public-origin/media/account configuration and an operational DB+media+key restore pilot.
