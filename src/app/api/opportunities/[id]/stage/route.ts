import { NextResponse } from "next/server";
import { handle, readJson } from "@/lib/api";
import { changeStage } from "@/lib/repo";
import { stageChangeSchema } from "@/lib/validation";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { stage, reason } = stageChangeSchema.parse(await readJson(req));
  await changeStage((await ctx.params).id, stage, reason);
  return NextResponse.json({ ok: true });
});
