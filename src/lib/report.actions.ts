"use server";

/**
 * The competitor report and audience-question pages' writes (build 2b, ideas
 * 1 and 2). Generating a report and mining comments spend money (or plan
 * usage), so they are owner-only (§1.20); setting a question's status is a
 * note, open to any signed-in user.
 *
 * Every action returns `{ ok, … } | { ok: false, error }` rather than
 * throwing: production strips a thrown action's message, and the refusals
 * ("no new outliers", the spend cap, a quota error) are what the owner needs
 * to read.
 */

import { revalidatePath } from "next/cache";
import { requireOwner, requireUser } from "@/lib/auth/session";
import {
  getAudienceQuestion,
  isAudienceQuestionStatus,
  setAudienceQuestionStatus,
} from "@/lib/bridge/questions";
import { writeScriptHref } from "@/lib/studio/report-contract";
import { mineQuestions } from "@/lib/studio/questions";
import { buildCompetitorReport } from "@/lib/studio/report";

export type ReportActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** "Generate now": a report for the last `days` days (7 by default). Owner only. */
export async function generateReportAction(
  brandId: string,
  days = 7,
): Promise<ReportActionResult<{ reportId: number }>> {
  try {
    await requireOwner("generate a competitor report");
    if (typeof brandId !== "string" || !brandId) return { ok: false, error: "Pick a brand first." };
    const window = Number.isInteger(days) && days > 0 && days <= 365 ? days : 7;
    const result = await buildCompetitorReport(brandId, window);
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/research/report");
    return { ok: true, reportId: result.report.id };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** "Mine comments": cluster the top outliers' comment questions. Owner only. */
export async function mineQuestionsAction(
  brandId: string,
): Promise<
  ReportActionResult<{ inserted: number; updated: number; comments: number; videos: number }>
> {
  try {
    await requireOwner("mine competitor comments");
    if (typeof brandId !== "string" || !brandId) return { ok: false, error: "Pick a brand first." };
    const result = await mineQuestions(brandId, { videos: 10 });
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/research/questions");
    return {
      ok: true,
      inserted: result.inserted,
      updated: result.updated,
      comments: result.comments,
      videos: result.videos,
    };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** Mark a question new / used / dismissed. */
export async function setQuestionStatusAction(
  id: number,
  status: string,
): Promise<ReportActionResult> {
  await requireUser();
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "That is not a question id." };
  if (!isAudienceQuestionStatus(status))
    return { ok: false, error: `Unknown status "${String(status)}".` };
  const row = await setAudienceQuestionStatus(id, status);
  if (!row) return { ok: false, error: "That question no longer exists." };
  revalidatePath("/research/questions");
  return { ok: true };
}

/**
 * "Write script" on a question: mark it used and hand back the brief's URL,
 * with the question as the topic. No refs: the videos a question was asked
 * under are rarely analysed, and the brief only takes analysed references.
 */
export async function writeScriptFromQuestionAction(
  id: number,
): Promise<ReportActionResult<{ href: string }>> {
  await requireUser();
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "That is not a question id." };
  const question = await getAudienceQuestion(id);
  if (!question) return { ok: false, error: "That question no longer exists." };
  await setAudienceQuestionStatus(id, "used");
  revalidatePath("/research/questions");
  return { ok: true, href: writeScriptHref(question.brandId, question.question) };
}
