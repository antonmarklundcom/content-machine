import { NextResponse } from "next/server";
import { isIdeaStatus, listAllIdeas, listIdeas } from "@/lib/bridge";

/**
 * `?brandId=` (required), `?status=` and `?page=` (optional). The response
 * stays a bare array of ideas either way; without `page` it is every idea, as
 * it was before paging existed, so the brand page's list keeps working.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const brandId = params.get("brandId");
  if (!brandId) {
    return NextResponse.json({ error: "brandId query param required" }, { status: 400 });
  }
  const status = params.get("status");
  if (status !== null && !isIdeaStatus(status)) {
    return NextResponse.json({ error: "unknown status" }, { status: 400 });
  }
  const pageParam = params.get("page");
  if (pageParam === null) {
    return NextResponse.json(await listAllIdeas(brandId, status ?? undefined));
  }
  const page = Number(pageParam);
  const result = await listIdeas({
    brandId,
    status: status ?? undefined,
    page: Number.isInteger(page) ? page : 1,
  });
  return NextResponse.json(result.ideas);
}
