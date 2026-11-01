import { NextResponse } from "next/server";
import { handle, readJson } from "@/lib/api";
import { createOpportunity, listOpportunities } from "@/lib/repo";
import { ideaSchema } from "@/lib/validation";

export const GET = handle(async () => NextResponse.json(await listOpportunities()));

export const POST = handle(async (req: Request) => {
  const input = ideaSchema.parse(await readJson(req));
  const { opportunity, similar } = await createOpportunity(input);
  return NextResponse.json({ opportunity, similar }, { status: 201 });
});
