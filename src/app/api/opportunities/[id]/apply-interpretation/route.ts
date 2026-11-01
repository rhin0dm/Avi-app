import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { getSql } from "@/lib/db";
import { UserError, updateOpportunity } from "@/lib/repo";

/** Copies the AI interpretation into empty fields only. Owner-entered text is never overwritten. */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = (await ctx.params).id;
  const [o] = await getSql()`select * from opportunities where id = ${id}`;
  if (!o?.interpretation) throw new UserError("No interpretation to apply");
  const it = o.interpretation;
  const tag = " [AI inference — unverified]";
  const list = (xs: string[]) => xs.map((x) => `• ${x}`).join("\n");
  const patch: Record<string, string> = {};
  if (!o.targetCustomer && it.targetCustomer) patch.targetCustomer = it.targetCustomer + tag;
  if (!o.problem && it.problem) patch.problem = it.problem + tag;
  if (!o.businessModels && it.businessModels?.length) patch.businessModels = list(it.businessModels) + "\n" + tag.trim();
  if (!o.revenueMechanisms && it.revenueMechanisms?.length) patch.revenueMechanisms = list(it.revenueMechanisms) + "\n" + tag.trim();
  if (!o.assumptions && it.assumptionsToInvestigate?.length) patch.assumptions = list(it.assumptionsToInvestigate) + "\n" + tag.trim();
  if (!o.primaryRisks && it.keyRisks?.length) patch.primaryRisks = list(it.keyRisks) + "\n" + tag.trim();
  await updateOpportunity(id, patch);
  return NextResponse.json({ applied: Object.keys(patch) });
});
