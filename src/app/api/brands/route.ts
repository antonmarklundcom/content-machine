import { NextResponse } from "next/server";
import { db, schema } from "../../../db";

export async function GET() {
  const brands = await db.select().from(schema.brands).orderBy(schema.brands.name);
  return NextResponse.json(brands);
}
