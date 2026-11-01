import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/lib/api";
import { classifyEvidence, linkEvidence } from "@/lib/repo";
import { EVIDENCE_LEVELS } from "@/lib/scoring";

const body = z.union([
  z.object({ action: z.enum(["link", "unlink"]), opportunityId: z.string().uuid() }),
  z.object({ action: z.literal("classify"), classification: z.enum(EVIDENCE_LEVELS.map((e) => e.key) as [string, ...string[]]) }),
]);

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = (await ctx.params).id;
  const b = body.parse(await readJson(req));
  if (b.action === "classify") await classifyEvidence(id, b.classification);
  else await linkEvidence(id, b.opportunityId, b.action === "link");
  return NextResponse.json({ ok: true });
});
