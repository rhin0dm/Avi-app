import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { runInterpretation } from "@/lib/ai/interpret";

export const maxDuration = 60;

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  return NextResponse.json(await runInterpretation((await ctx.params).id));
});
