import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/lib/api";
import { saveFinancialModel } from "@/lib/repo";
import { financialInputsSchema, scenariosSchema } from "@/lib/finance";

const body = z.object({ inputs: financialInputsSchema, scenarios: scenariosSchema });

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { inputs, scenarios } = body.parse(await readJson(req));
  await saveFinancialModel((await ctx.params).id, inputs, scenarios);
  return NextResponse.json({ ok: true });
});
