import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { listBrands } from "@/lib/bridge";
import { CLIP_PURPOSES } from "@/db/schema";
import { ShareCaptureForm } from "./ShareCaptureForm";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: translator(await getLocale())("inbox.quickAdd.submit"),
    robots: { index: false },
  };
}

export const dynamic = "force-dynamic";

/** Any http(s) URL substring — what share text usually wraps a link in. */
const URL_PATTERN = /https?:\/\/\S+/i;

function firstUrl(...candidates: (string | undefined)[]): string {
  for (const candidate of candidates) {
    const match = candidate?.match(URL_PATTERN)?.[0];
    if (match) return match.replace(/[)\]}>."',]+$/, "");
  }
  return "";
}

/**
 * The share_target landing page (PLAN.md §6.S3.3, manifest.ts).
 *
 * The OS share sheet hands this page whatever the sharing app felt like
 * sending — sometimes a clean `url`, more often a `text` with the link buried
 * in a caption ("Check this out https://instagram.com/reel/… 🔥"). This page
 * is deliberately thin: it just makes its best guess at the link, lets the
 * note be edited, and hands off to the same `POST /api/clips` the quick-add
 * form and the iOS Shortcut both call — no second save path.
 */
export default async function SharePage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; title?: string; text?: string }>;
}) {
  await requireUser();
  const [params, brands, locale] = await Promise.all([searchParams, listBrands(), getLocale()]);
  const t = translator(locale);
  const guessedUrl = firstUrl(params.url, params.text, params.title);
  // Whatever text is left over, once the URL itself is stripped out, is the
  // closest thing to "why I saved this" a share sheet ever hands over.
  const guessedNote = [params.title, params.text]
    .filter(Boolean)
    .join(" — ")
    .replace(URL_PATTERN, "")
    .trim();

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <ShareCaptureForm
        initialUrl={guessedUrl}
        initialNote={guessedNote}
        brands={brands.map((b) => ({ id: b.id, name: b.name }))}
        purposes={CLIP_PURPOSES.map((p) => ({ id: p, label: t(`capture.purpose.${p}`) }))}
        labels={{
          brand: t("capture.brand"),
          noBrand: t("capture.noBrand"),
          purpose: t("capture.purpose"),
          tags: t("capture.tags"),
          tagsPlaceholder: t("capture.tagsPlaceholder"),
        }}
      />
    </main>
  );
}
