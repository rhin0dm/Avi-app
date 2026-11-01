import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/lib/api";
import { mergeOpportunities } from "@/lib/repo";

const body = z.object({ targetId: z.string().uuid(), reason: z.string().trim().min(3).max(2000) });

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { targetId, reason } = body.parse(await readJson(req));
  await mergeOpportunities((await ctx.params).id, targetId, reason);
  return NextResponse.json({ ok: true });
});
