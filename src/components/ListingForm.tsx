"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TranslationKey } from "@/lib/i18n";
import { useTranslator } from "@/lib/i18n/client";
import { readListing, writeListingScript } from "@/lib/listing.actions";
import { SCRIPT_LANGUAGES, type ScriptLanguage } from "@/lib/scripts/contract";
import { emptyListing, type ListingFields, type ListingMode } from "@/lib/studio/listing";
import { STUDIO_BUTTON, STUDIO_INPUT, STUDIO_LABEL as LABEL, STUDIO_PRIMARY } from "./StudioStyles";

type TextField = Exclude<keyof ListingFields, "images" | "url" | "description" | "notes">;

const SHORT_FIELDS: { key: TextField; label: TranslationKey }[] = [
  { key: "price", label: "listing.field.price" },
  { key: "currency", label: "listing.field.currency" },
  { key: "rooms", label: "listing.field.rooms" },
  { key: "bathrooms", label: "listing.field.bathrooms" },
  { key: "area", label: "listing.field.area" },
];

/**
 * The listing form (build 2b, idea 8): URL → "Read listing" fills the fields,
 * every field stays editable, then "Write short" or "Write tour" saves a draft
 * and opens it in the studio.
 */
export function ListingForm({
  brands,
  brandId: initialBrand,
}: {
  brands: { id: string; name: string; language: ScriptLanguage }[];
  brandId: string;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [brandId, setBrandId] = useState(initialBrand);
  const [language, setLanguage] = useState<ScriptLanguage>(
    brands.find((b) => b.id === initialBrand)?.language ?? "en",
  );
  const [url, setUrl] = useState("");
  const [fields, setFields] = useState<ListingFields>(emptyListing());
  const [imagesText, setImagesText] = useState("");
  const [busy, setBusy] = useState<"read" | ListingMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const set = (key: keyof ListingFields, value: string) =>
    setFields((f) => ({ ...f, [key]: value }));
  const images = imagesText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  async function read() {
    setError(null);
    setErrors([]);
    setNotice(null);
    setBusy("read");
    try {
      const result = await readListing(url);
      if (!result.ok) return setError(result.error);
      setFields({ ...result.listing, notes: fields.notes });
      setImagesText(result.listing.images.join("\n"));
      setNotice(t("listing.readDone"));
    } catch {
      setError(t("listing.error"));
    } finally {
      setBusy(null);
    }
  }

  async function write(mode: ListingMode) {
    setError(null);
    setErrors([]);
    setNotice(null);
    setBusy(mode);
    try {
      const result = await writeListingScript({
        brandId,
        mode,
        language,
        listing: { ...fields, url: fields.url || url, images },
      });
      if (!result.ok) {
        setError(result.error);
        setErrors(result.errors ?? []);
        return;
      }
      router.push(`/studio/${result.id}`);
    } catch {
      setError(t("listing.error"));
    } finally {
      setBusy(null);
    }
  }

  const canWrite = Boolean(
    fields.title.trim() || fields.description.trim() || fields.address.trim(),
  );

  return (
    <form className="mt-6 flex flex-col gap-6" onSubmit={(e) => e.preventDefault()}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-0 flex-1">
          <span className={LABEL}>{t("listing.url")}</span>
          <input
            type="url"
            className={STUDIO_INPUT}
            value={url}
            placeholder="https://propia.com.py/propiedad/…"
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <button
          type="button"
          className={STUDIO_BUTTON}
          disabled={!url.trim() || busy !== null}
          onClick={read}
        >
          {busy === "read" ? t("listing.reading") : t("listing.read")}
        </button>
      </div>
      {notice && <p className="text-sm text-[var(--color-ink-muted)]">{notice}</p>}

      <label className="block">
        <span className={LABEL}>{t("listing.field.title")}</span>
        <input
          className={STUDIO_INPUT}
          value={fields.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </label>
      <label className="block">
        <span className={LABEL}>{t("listing.field.description")}</span>
        <textarea
          rows={4}
          className={STUDIO_INPUT}
          value={fields.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </label>
      <label className="block">
        <span className={LABEL}>{t("listing.field.address")}</span>
        <input
          className={STUDIO_INPUT}
          value={fields.address}
          onChange={(e) => set("address", e.target.value)}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-5">
        {SHORT_FIELDS.map(({ key, label }) => (
          <label key={key} className="block">
            <span className={LABEL}>{t(label)}</span>
            <input
              className={STUDIO_INPUT}
              value={fields[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          </label>
        ))}
      </div>

      <label className="block">
        <span className={LABEL}>{t("listing.field.images", { n: images.length })}</span>
        <textarea
          rows={4}
          className={`${STUDIO_INPUT} font-mono text-xs`}
          value={imagesText}
          onChange={(e) => setImagesText(e.target.value)}
        />
        <span className="mt-1 block text-xs text-[var(--color-ink-muted)]">
          {t("listing.field.imagesHelp")}
        </span>
      </label>
      {images.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {images.slice(0, 12).map((src, i) => (
            <li
              key={src}
              className="surface-border relative overflow-hidden rounded-[var(--radius-sm)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- remote listing photos, any host */}
              <img
                src={src}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="aspect-video w-full object-cover"
              />
              <span className="absolute top-1 left-1 rounded bg-black/60 px-1 text-xs text-white">
                P{i + 1}
              </span>
            </li>
          ))}
        </ul>
      )}

      <label className="block">
        <span className={LABEL}>{t("listing.field.notes")}</span>
        <textarea
          rows={3}
          className={STUDIO_INPUT}
          value={fields.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>{t("listing.brand")}</span>
          <select
            className={STUDIO_INPUT}
            value={brandId}
            onChange={(e) => {
              setBrandId(e.target.value);
              setLanguage(brands.find((b) => b.id === e.target.value)?.language ?? "en");
            }}
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>{t("listing.language")}</span>
          <select
            className={STUDIO_INPUT}
            value={language}
            onChange={(e) => setLanguage(e.target.value as ScriptLanguage)}
          >
            {SCRIPT_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div role="alert" className="text-sm text-[var(--color-danger)]">
          <p>{error}</p>
          {errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {errors.slice(0, 10).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={STUDIO_PRIMARY}
          disabled={!canWrite || busy !== null}
          onClick={() => write("short")}
        >
          {busy === "short" ? t("listing.writing") : t("listing.writeShort")}
          <span className="ml-2 text-xs opacity-80">{t("listing.writeShortHelp")}</span>
        </button>
        <button
          type="button"
          className={STUDIO_PRIMARY}
          disabled={!canWrite || busy !== null}
          onClick={() => write("tour")}
        >
          {busy === "tour" ? t("listing.writing") : t("listing.writeTour")}
          <span className="ml-2 text-xs opacity-80">{t("listing.writeTourHelp")}</span>
        </button>
      </div>
      <p className="text-xs text-[var(--color-ink-muted)]">{t("listing.spends")}</p>
    </form>
  );
}
