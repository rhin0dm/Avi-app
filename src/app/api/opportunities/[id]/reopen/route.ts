import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/lib/api";
import { reopenOpportunity } from "@/lib/repo";

const body = z.object({ reason: z.string().trim().min(3).max(2000) });

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { reason } = body.parse(await readJson(req));
  await reopenOpportunity((await ctx.params).id, reason);
  return NextResponse.json({ ok: true });
});
