"use client";

import { useActionState, useState } from "react";
import type { BrandKit, KitColor, KitFont } from "@/db/schema";
import { saveKitAction, type AccountsActionResult } from "@/lib/accounts.actions";
import { translator, type Locale } from "@/lib/i18n";
import { AccountSubmitRow, CARD, FIELD, LABEL, SECONDARY } from "./AccountFields";

export type KitLogoOption = { id: number; label: string; hasThumb: boolean };

/** `#rrggbb` or `#rgb`, with or without the `#` — the same rule the action applies. */
function swatchHex(value: string): string | null {
  const hex = value.trim().replace(/^#?/, "#").toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  if (/^#[0-9a-f]{3}$/.test(hex)) return `#${[...hex.slice(1)].map((c) => c + c).join("")}`;
  return null;
}

type Row<T> = T & { key: number };
let nextKey = 0;
const keyed = <T,>(items: T[]): Row<T>[] => items.map((item) => ({ ...item, key: nextKey++ }));

/**
 * The brand kit editor (PLAN.md §6.S13): colours with live swatches, fonts,
 * a logo picked from the media library (never uploaded here), Higgsfield
 * element/character ids, CTAs, hashtags, dos and don'ts.
 */
export function KitEditor({
  brandId,
  kit,
  logoOptions,
  locale,
  canEdit,
}: {
  brandId: string;
  kit: BrandKit | null;
  logoOptions: KitLogoOption[];
  locale: Locale;
  canEdit: boolean;
}) {
  const t = translator(locale);
  const [state, formAction, pending] = useActionState(
    saveKitAction,
    null as AccountsActionResult | null,
  );
  const [colors, setColors] = useState<Row<KitColor>[]>(() =>
    keyed(kit?.colors.length ? kit.colors : [{ name: "", hex: "" }]),
  );
  const [fonts, setFonts] = useState<Row<KitFont>[]>(() =>
    keyed(kit?.fonts.length ? kit.fonts : [{ role: "", family: "" }]),
  );
  const [logo, setLogo] = useState(kit?.logoAssetId ? String(kit.logoAssetId) : "");
  const logoOption = logoOptions.find((o) => String(o.id) === logo);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="brandId" value={brandId} />
      <fieldset disabled={!canEdit} className="flex flex-col gap-5">
        <section className={CARD}>
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">
            {t("accounts.kit.colors")}
          </h2>
          <ul className="flex flex-col gap-2">
            {colors.map((c, i) => {
              const hex = swatchHex(c.hex);
              const invalid = c.hex.trim() !== "" && !hex;
              return (
                <li key={c.key} className="flex flex-wrap items-center gap-2">
                  <span
                    aria-hidden
                    className="surface-border h-9 w-9 shrink-0 rounded-[var(--radius-sm)]"
                    style={{
                      background: hex ?? "transparent",
                      backgroundImage: hex
                        ? undefined
                        : "linear-gradient(135deg, transparent 45%, var(--color-danger) 45%, var(--color-danger) 55%, transparent 55%)",
                    }}
                  />
                  <input
                    name="colorName"
                    aria-label={t("accounts.kit.colorName")}
                    placeholder={t("accounts.kit.colorName")}
                    value={c.name}
                    onChange={(e) =>
                      setColors((all) =>
                        all.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)),
                      )
                    }
                    className={`${FIELD} max-w-48`}
                  />
                  <input
                    name="colorHex"
                    aria-label={t("accounts.kit.colorHex")}
                    aria-invalid={invalid}
                    placeholder="#1a2b3c"
                    value={c.hex}
                    onChange={(e) =>
                      setColors((all) =>
                        all.map((r, j) => (j === i ? { ...r, hex: e.target.value } : r)),
                      )
                    }
                    className={`${FIELD} max-w-32 font-mono ${invalid ? "border-[var(--color-danger)]" : ""}`}
                  />
                  {invalid && (
                    <span className="text-xs text-[var(--color-danger)]">
                      {t("accounts.kit.invalidHex")}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setColors((all) => all.filter((_, j) => j !== i))}
                    className={SECONDARY}
                  >
                    {t("accounts.kit.remove")}
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => setColors((all) => [...all, ...keyed([{ name: "", hex: "" }])])}
            className={`${SECONDARY} mt-3`}
          >
            {t("accounts.kit.addColor")}
          </button>
        </section>

        <section className={CARD}>
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">
            {t("accounts.kit.fonts")}
          </h2>
          <ul className="flex flex-col gap-2">
            {fonts.map((f, i) => (
              <li key={f.key} className="flex flex-wrap items-center gap-2">
                <input
                  name="fontRole"
                  aria-label={t("accounts.kit.fontRole")}
                  placeholder="heading"
                  value={f.role}
                  onChange={(e) =>
                    setFonts((all) =>
                      all.map((r, j) => (j === i ? { ...r, role: e.target.value } : r)),
                    )
                  }
                  className={`${FIELD} max-w-40`}
                />
                <input
                  name="fontFamily"
                  aria-label={t("accounts.kit.fontFamily")}
                  placeholder="Inter"
                  value={f.family}
                  onChange={(e) =>
                    setFonts((all) =>
                      all.map((r, j) => (j === i ? { ...r, family: e.target.value } : r)),
                    )
                  }
                  className={`${FIELD} max-w-64`}
                  style={f.family ? { fontFamily: f.family } : undefined}
                />
                <button
                  type="button"
                  onClick={() => setFonts((all) => all.filter((_, j) => j !== i))}
                  className={SECONDARY}
                >
                  {t("accounts.kit.remove")}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setFonts((all) => [...all, ...keyed([{ role: "", family: "" }])])}
            className={`${SECONDARY} mt-3`}
          >
            {t("accounts.kit.addFont")}
          </button>
        </section>

        <section className={CARD}>
          <h2 className="mb-1 text-sm font-semibold text-[var(--color-ink)]">
            {t("accounts.kit.logo")}
          </h2>
          <p className="mb-3 text-xs text-[var(--color-ink-muted)]">{t("accounts.kit.logoHint")}</p>
          {logoOptions.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-muted)]">{t("accounts.kit.logoEmpty")}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <select
              name="logoAssetId"
              aria-label={t("accounts.kit.logo")}
              value={logo}
              onChange={(e) => setLogo(e.target.value)}
              className={`${FIELD} max-w-80`}
            >
              <option value="">{t("accounts.kit.logoNone")}</option>
              {logoOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {logoOption?.hasThumb && (
              // eslint-disable-next-line @next/next/no-img-element -- an owner-only media route, not a static asset
              <img
                src={`/api/media/asset/${logoOption.id}/thumb`}
                alt=""
                className="surface-border h-16 w-16 rounded-[var(--radius-sm)] object-contain"
              />
            )}
          </div>
        </section>

        <section className={`${CARD} grid gap-3 sm:grid-cols-2`}>
          <h2 className="text-sm font-semibold text-[var(--color-ink)] sm:col-span-2">
            {t("accounts.kit.higgsfield")}
          </h2>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>{t("accounts.kit.elementIds")}</span>
            <textarea
              name="elementIds"
              rows={2}
              defaultValue={kit?.higgsfield.elementIds.join("\n")}
              placeholder={t("accounts.kit.listHint")}
              className={`${FIELD} font-mono`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>{t("accounts.kit.characterIds")}</span>
            <textarea
              name="characterIds"
              rows={2}
              defaultValue={kit?.higgsfield.characterIds.join("\n")}
              placeholder={t("accounts.kit.listHint")}
              className={`${FIELD} font-mono`}
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={LABEL}>{t("accounts.kit.styleNotes")}</span>
            <textarea
              name="styleNotes"
              rows={2}
              defaultValue={kit?.higgsfield.styleNotes}
              className={FIELD}
            />
          </label>
        </section>

        <section className={`${CARD} grid gap-3 sm:grid-cols-2`}>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>{t("accounts.kit.ctas")}</span>
            <textarea name="ctas" rows={4} defaultValue={kit?.ctas.join("\n")} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>{t("accounts.kit.hashtags")}</span>
            <textarea
              name="hashtags"
              rows={4}
              defaultValue={kit?.hashtags.map((h) => `#${h}`).join(" ")}
              placeholder="#paraguay #residency"
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>{t("accounts.kit.dos")}</span>
            <textarea name="dos" rows={4} defaultValue={kit?.dos ?? ""} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>{t("accounts.kit.donts")}</span>
            <textarea name="donts" rows={4} defaultValue={kit?.donts ?? ""} className={FIELD} />
          </label>
        </section>
      </fieldset>
      {canEdit ? (
        <AccountSubmitRow
          locale={locale}
          label={t("accounts.save")}
          pending={pending}
          state={state}
        />
      ) : (
        <p className="text-sm text-[var(--color-ink-muted)]">{t("accounts.ownerOnly")}</p>
      )}
    </form>
  );
}
