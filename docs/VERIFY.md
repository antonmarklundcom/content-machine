# Verification

The Hostinger/MariaDB conversion is merged in [PR #1](https://github.com/antonmarklundcom/content-machine/pull/1). Its [final PR-head CI run](https://github.com/antonmarklundcom/content-machine/actions/runs/37856383516) passed native MariaDB 10.11/11.4, Windows, SQL dump/restore and isolated Linux standalone checks before merge. [Completion report](CONVERSION-REPORT.md) and [findings](CONVERSION-FINDINGS.md) record coverage and limitations.

## Current owner policy — 8 October 2026

GitHub CI runs only when explicitly dispatched. Pushes and PRs do not start it automatically, and no repository branch rule requires GitHub status checks. Agents run checks appropriate to the change, inspect the diff/conflicts and record the exact validated revision plus actual pass/fail/skip results before merging. Sol/Claude review does not replace executing tests. The completed conversion's CI requirement is historical; this policy governs subsequent work.

Documentation and workflow-trigger changes need focused formatting/configuration validation and diff review. Code changes need affected regression tests and applicable type/lint/build checks. Database changes need disposable native MariaDB migration/query/concurrency checks; recovery changes need an actual synthetic dump and restoration. Hosting/runtime packaging changes need an isolated physical Linux artifact. If the necessary environment is missing, use manual native CI or establish it locally before merging the affected high-risk change.

## Local automated checks

Use npm.cmd on Windows if PowerShell blocks npm:

```sh
npm ci
npm run audit:production
npm run typecheck
npm run typecheck:worker
npm run lint
npm test
npm run test:worker
```

Run only the applicable subset for a narrow change. After confirming a dedicated disposable MariaDB URL and setting ALLOW_DESTRUCTIVE_TEST_DB=1, use npm run test:db. The database name must end in _test and the host must be loopback or explicitly test-allowlisted. Never use operational data. npm run verify combines app types, lint/format, unit tests, native database tests and build; it does not include the separate worker or production-audit commands.

## Optional manual native CI

The retained workflow provisions MariaDB 10.11 and 11.4 and runs clean installation, production audit, app/worker checks, full native tests, SQL backup/restoration, production build and physical standalone validation. It also retains Windows checks. Explicitly start it from Actions → CI → Run workflow, or select the branch with:

```sh
gh workflow run ci.yml --repo antonmarklundcom/content-machine --ref codex/your-branch
```

Record the run's exact head SHA and actual results. Do not infer success from workflow dispatch. [GitHub manual-workflow documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

The artifact steps are described in [DEPLOY-HOSTINGER.md](DEPLOY-HOSTINGER.md). Build/package hooks must not connect to operational databases, migrate, seed or contact providers.

## Live checks and historical records

Synthetic verification does not certify the actual Hostinger plan, persistent media, account credentials, OAuth callbacks, billing or live publishing. The repository is not deployed. Paid/live probes require separate authorization. PC-only tools remain dependent on local configuration.

Earlier PostgreSQL/Neon and conversion-CI instructions are historical. See [source provenance](SOURCE-PROVENANCE.md) and [original audit](AUDIT-FIXES-2026-10-08.md). To restore automatic CI later, restore the push/main and pull_request triggers through a reviewed change and update this policy.
