import { requireUser } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { StudioTeleprompter } from "@/components/StudioTeleprompter";
import { teleprompterBlocks } from "../../model";
import { loadScript } from "../load";

/** `/studio/[id]/teleprompter` — the saved script's spoken lines, full screen (PLAN.md §6.S12.2). */
export default async function TeleprompterPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { row, body, valid } = await loadScript((await params).id);
  if (!valid) {
    const t = translator(await getLocale());
    return (
      <p className="p-10 text-sm text-[var(--color-danger)]">{t("studio.editor.unreadable")}</p>
    );
  }
  return (
    <StudioTeleprompter
      title={row.title}
      blocks={teleprompterBlocks(body)}
      backHref={`/studio/${row.id}`}
    />
  );
}
