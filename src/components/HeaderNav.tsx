"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavLink = {
  href: string;
  label: string;
  /** Other path prefixes that belong to this link (e.g. `/clips` under Inbox). */
  also?: string[];
};
export type NavItem = NavLink | { label: string; items: NavLink[] };

const LINK =
  "text-sm transition-colors hover:text-[var(--color-ink)] rounded-[var(--radius-sm)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const IDLE = "text-[var(--color-ink-muted)]";
const ACTIVE =
  "text-[var(--color-ink)] font-medium underline decoration-[var(--color-accent)] decoration-2 underline-offset-8";

function prefixes(link: NavLink): string[] {
  return [link.href, ...(link.also ?? [])];
}

function matches(pathname: string, prefix: string): boolean {
  return prefix === "/"
    ? pathname === "/"
    : pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The header's links with the current page highlighted (PLAN.md §6.S20). The
 * longest matching prefix wins, so `/research/report` lights Report, not
 * Outliers (`/research`). A group opens on hover or focus (a tap on a phone),
 * so there is still no menu state.
 */
export function HeaderNav({ nav }: { nav: NavItem[] }) {
  const pathname = usePathname() ?? "/";
  const links = nav.flatMap((item) => ("items" in item ? item.items : [item]));
  let active: string | null = null;
  let best = -1;
  for (const link of links) {
    for (const prefix of prefixes(link)) {
      if (matches(pathname, prefix) && prefix.length > best) {
        best = prefix.length;
        active = link.href;
      }
    }
  }

  return (
    <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {nav.map((item) =>
        "items" in item ? (
          <div key={item.label} className="group relative">
            <button
              type="button"
              aria-haspopup="true"
              className={`${LINK} ${item.items.some((s) => s.href === active) ? ACTIVE : IDLE} flex items-center gap-1`}
            >
              {item.label}
              <span aria-hidden className="text-[10px]">
                ▾
              </span>
            </button>
            <div className="absolute left-0 top-full z-20 hidden pt-2 group-hover:block group-focus-within:block">
              <ul className="surface-border flex min-w-40 flex-col gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface)] p-2 shadow-lg">
                {item.items.map((sub) => (
                  <li key={sub.href}>
                    <Link
                      href={sub.href}
                      aria-current={sub.href === active ? "page" : undefined}
                      className={`${LINK} ${sub.href === active ? "text-[var(--color-ink)] font-medium" : IDLE} block rounded-[var(--radius-sm)] px-2 py-1`}
                    >
                      {sub.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.href === active ? "page" : undefined}
            className={`${LINK} ${item.href === active ? ACTIVE : IDLE}`}
          >
            {item.label}
          </Link>
        ),
      )}
    </nav>
  );
}
