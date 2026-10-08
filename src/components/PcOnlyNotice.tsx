import { isOnlineDeploy } from "@/lib/pc-only";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

/** Shown above PC-only features on the online deploy (`APP_MODE=online`); renders nothing on the PC. */
export async function PcOnlyNotice() {
  if (!isOnlineDeploy()) return null;
  const t = translator(await getLocale());
  return (
    <div className="mx-auto mt-4 max-w-5xl px-4 sm:px-6">
      <p className="surface-border surface-card px-4 py-3 text-sm text-[var(--color-ink)]">
        <strong>{t("pcOnly.title")}</strong> {t("pcOnly.body")}
      </p>
    </div>
  );
}
