# Conversion findings and improvement log

2026-10-08. Working log; confirmed defects, suspicions and configuration gaps remain distinct. No complete-bug-coverage claim.

## Confirmed database/conversion findings

Pending source verification and native MariaDB reproduction.

## Additional inherited audit findings

Second audit BUG-16…22 will be reverified against source commit 4c8c735. Historical reports do not prove a fix or a current defect.

## Improvements

- **CM-IMP-01 — Claude Haiku 5.5 API evaluation (LATER).** Consider `claude-haiku-5-5` for classification/extraction/routing before content generation. Official Anthropic documentation identifies the model; pricing and output quality require a dated check and synthetic eval plan. No provider implementation or paid call in this conversion.
- **CM-IMP-02 — One useful local/hosted readiness view (DO NOW subset).** Diagnose DB/schema/media/tools/worker readiness without secret values or external-spend probes.
