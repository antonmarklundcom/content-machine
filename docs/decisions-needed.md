# Decisions needed

## Inherited Content Engine decision log — historical

The entries below are retained as source-project history, not as an active queue
of owner decisions for Content Machine. Inherited phase and Neon instructions
are superseded by the Content Machine MariaDB/MySQL conversion. In particular,
O4's Neon HTTP transaction limitation is not a current foundation decision or
owner blocker. Current conversion blockers and their evidence belong in
[CONVERSION-FINDINGS.md](CONVERSION-FINDINGS.md).

### O4 · 2026-09-11 · Neon HTTP transaction limitation (superseded)

The Content Engine source recorded that `drizzle-orm/neon-http` did not support
`db.transaction()` at two call sites. That was a source-project driver
constraint. Content Machine uses the native MySQL protocol driver and
MariaDB-compatible Drizzle schema/migrations; no new decision about Neon is
needed here. See [source provenance](SOURCE-PROVENANCE.md) and the conversion
plan for source and target architecture.

### O5 · 2026-09-11 · source-project live smoke run (historical, not authorized)

The source project recorded an unrun paid Gemini smoke check for its reservation
estimates. Its historical instructions used Neon/PostgreSQL and are not valid
for this repository. No live-provider check or paid probe is implied by retaining
this note. Any such check requires separate authorization and a current safe
procedure; synthetic CI evidence and conversion status are tracked separately.

### O8 · 2026-09-26 · source-project watcher

The inherited watcher concern and its 2026-09-27 resolution are retained in
source history. It is not a Content Machine decision; see the original source
repository history for full context.

### O9 · 2026-09-27 · source-project seed values

The inherited pending-brand seed values were recorded as resolved in the source
project. This entry is preserved for provenance only.

### S17 · 2026-09-27 · source-project command and environment follow-up

The inherited `clips:fetch` command and environment follow-up was recorded as
done by S20. It is preserved for provenance only.
