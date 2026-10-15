"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

export type NavLink = {
  href: string;
  label: string;
  description?: string;
  /** Other path prefixes belonging to this link, such as /clips under Inbox. */
  also?: string[];
};
export type NavItem = NavLink | { label: string; description?: string; items: NavLink[] };

const LINK =
  "rounded-xl px-3 py-2 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const IDLE =
  "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-ink)]";
const ACTIVE = "bg-[var(--color-accent-ink)] font-semibold text-[var(--color-accent)]";

function matches(pathname: string, prefix: string): boolean {
  return prefix === "/"
    ? pathname === "/"
    : pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Click/tap navigation with ordinary links, Escape dismissal and visible focus. */
export function HeaderNav({
  nav,
  label = "Main navigation",
  menuLabel = "Menu & tools",
}: {
  nav: NavItem[];
  label?: string;
  menuLabel?: string;
}) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const links = nav.flatMap((item) => ("items" in item ? item.items : [item]));
  let active: string | null = null;
  let best = -1;
  for (const link of links) {
    for (const prefix of [link.href, ...(link.also ?? [])]) {
      if (matches(pathname, prefix) && prefix.length > best) {
        best = prefix.length;
        active = link.href;
      }
    }
  }

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(null);
        setMobileOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && root.current?.contains(document.activeElement)) {
        setOpen(null);
        setMobileOpen(false);
        if (window.matchMedia("(max-width: 639px)").matches) menuButton.current?.focus();
        else trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  return (
    <nav
      ref={root}
      aria-label={label}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(null);
          setMobileOpen(false);
        }
      }}
    >
      <button
        ref={menuButton}
        type="button"
        aria-expanded={mobileOpen}
        aria-controls={`${id}-mobile`}
        className={`${LINK} ${IDLE} flex w-full items-center justify-between border border-[var(--color-border-subtle)] sm:hidden`}
        onClick={() => {
          setMobileOpen(!mobileOpen);
          setOpen(null);
        }}
      >
        {menuLabel}
        <span aria-hidden="true">{mobileOpen ? "−" : "+"}</span>
      </button>
      <div
        id={`${id}-mobile`}
        className={`${mobileOpen ? "flex" : "hidden"} absolute inset-x-0 top-full z-40 mt-2 max-h-[65vh] flex-col gap-1 overflow-y-auto rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-2 shadow-xl sm:static sm:mt-0 sm:flex sm:max-h-none sm:flex-row sm:flex-wrap sm:items-center sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none`}
      >
        {nav.map((item, index) =>
          "items" in item ? (
            <div key={item.label} className="sm:relative">
              <button
                type="button"
                aria-expanded={open === item.label}
                aria-controls={`${id}-${index}`}
                className={`${LINK} ${item.items.some((sub) => sub.href === active) ? ACTIVE : IDLE} flex items-center gap-2`}
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  setOpen(open === item.label ? null : item.label);
                }}
              >
                {item.label}
                <span
                  aria-hidden="true"
                  className={`text-[10px] transition-transform ${open === item.label ? "rotate-180" : ""}`}
                >
                  ▾
                </span>
              </button>
              <div
                id={`${id}-${index}`}
                hidden={open !== item.label}
                className={`surface-border relative z-40 mt-2 overflow-hidden rounded-2xl bg-[var(--color-surface)] sm:absolute sm:inset-x-auto sm:top-full sm:w-80 sm:shadow-xl ${index === nav.length - 1 ? "sm:right-0" : "sm:left-0"}`}
              >
                {item.description && (
                  <p className="border-b border-[var(--color-border-subtle)] px-4 py-3 text-xs leading-relaxed text-[var(--color-ink-muted)]">
                    {item.description}
                  </p>
                )}
                <ul className="flex max-h-[min(60vh,30rem)] flex-col gap-1 overflow-y-auto p-2">
                  {item.items.map((sub) => (
                    <li key={sub.href}>
                      <Link
                        href={sub.href}
                        aria-current={sub.href === active ? "page" : undefined}
                        onClick={() => {
                          setOpen(null);
                          setMobileOpen(false);
                        }}
                        className={`${LINK} ${sub.href === active ? ACTIVE : IDLE} block`}
                      >
                        <span className="block font-medium">{sub.label}</span>
                        {sub.description && (
                          <span className="mt-0.5 block text-xs font-normal leading-relaxed text-[var(--color-ink-muted)]">
                            {sub.description}
                          </span>
                        )}
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
              onClick={() => {
                setOpen(null);
                setMobileOpen(false);
              }}
              aria-current={item.href === active ? "page" : undefined}
              className={`${LINK} ${item.href === active ? ACTIVE : IDLE}`}
            >
              {item.label}
            </Link>
          ),
        )}
      </div>
    </nav>
  );
}
