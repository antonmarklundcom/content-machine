# `src/lib/bridge/` — the query layer between the app's two halves

The brand-ideation half (`brands`/`research_notes`/`ideas`) and the YouTube
research half (`sources`→`videos`→`analyses`→`topics`) share a repo, a deploy
and a login, and now share data through exactly these functions (PLAN.md
§5.O1.4).

Two rules keep that boundary meaningful:

1. **Expose only what a later phase needs.** Reads and feature-owned writes
   live in this layer; view components call these functions.
2. **Later phases read through here.** The Sonnet UI phase (§4.7) may not
   query `db` directly — if a page needs a shape this module does not expose,
   the shape gets added here rather than a join getting written in a view.

Everything here is server-side: `db` uses a bounded MariaDB/mysql2 pool and the modules are
marked `server-only` so an accidental client import fails at build time rather
than at runtime.
