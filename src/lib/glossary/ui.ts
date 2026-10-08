/** Shared /glossary UI constants (plain module, so server and client components can both import them). */

import type { GlossaryRegister } from "@/db/schema";

export const GLOSSARY_FIELD =
  "surface-border w-full rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
export const GLOSSARY_BUTTON =
  "rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/** Mirrors `GLOSSARY_REGISTERS` (a type-only import keeps the schema out of the client bundle). */
export const REGISTERS: readonly GlossaryRegister[] = ["everyday", "kids", "formal", "slang"];
