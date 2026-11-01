import { NextResponse } from "next/server";
import { handle, readJson } from "@/lib/api";
import { saveScore } from "@/lib/repo";
import { scoreInputSchema } from "@/lib/validation";
import type { CriterionScore, GateAssessment } from "@/lib/scoring";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const input = scoreInputSchema.parse(await readJson(req));
  const { result } = await saveScore((await ctx.params).id, input.criteria as CriterionScore[], input.gates as GateAssessment[]);
  return NextResponse.json(result);
});
