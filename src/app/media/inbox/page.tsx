import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { MediaLibrary } from "@/components/MediaLibrary";
import type { MediaSearchParams } from "../query";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("media.inbox.title") };
}

/** The unsorted inbox (PLAN.md §6.S14): where `/higgsfield-import` lands. */
export default async function MediaInboxPage({
  searchParams,
}: {
  searchParams: Promise<MediaSearchParams>;
}) {
  const params = await searchParams;
  await requireUser();
  return <MediaLibrary locale={await getLocale()} params={params} inbox />;
}
