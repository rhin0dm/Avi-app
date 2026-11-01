import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/lib/api";
import { createScoringVersion } from "@/lib/repo";
import { CRITERIA, type Weights } from "@/lib/scoring";

const body = z.object({
  label: z.string().trim().min(2).max(120),
  notes: z.string().max(2000).optional(),
  weights: z.object(Object.fromEntries(CRITERIA.map((c) => [c.key, z.number().int().min(0).max(100)]))),
  thresholds: z.object({ pass: z.number().min(0).max(100), investigate: z.number().min(0).max(100), minEvidenceConfidence: z.number().min(0).max(1) }),
});

export const POST = handle(async (req: Request) => {
  const b = body.parse(await readJson(req));
  const v = await createScoringVersion(b.label, b.weights as Weights, b.thresholds, b.notes);
  return NextResponse.json(v, { status: 201 });
});
