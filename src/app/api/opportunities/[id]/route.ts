import { NextResponse } from "next/server";
import { handle, readJson } from "@/lib/api";
import { getOpportunity, updateOpportunity } from "@/lib/repo";
import { opportunityPatchSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const data = await getOpportunity((await ctx.params).id);
  return data ? NextResponse.json(data) : NextResponse.json({ error: "Not found" }, { status: 404 });
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const patch = opportunityPatchSchema.parse(await readJson(req));
  return NextResponse.json(await updateOpportunity((await ctx.params).id, patch));
});
