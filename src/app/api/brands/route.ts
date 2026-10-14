import { authoringApiGuard } from "@/lib/auth/api-guard";
import { NextResponse } from "next/server";
import { db, schema } from "../../../db";

export async function GET() {
  const denied = await authoringApiGuard();
  if (denied) return denied;
  const brands = await db.select().from(schema.brands).orderBy(schema.brands.name);
  return NextResponse.json(brands);
}
