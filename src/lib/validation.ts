import { z } from "zod";
import { CRITERIA, GATES, EVIDENCE_LEVELS } from "./scoring";

const text = (max = 5000) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const money = z.union([z.number(), z.string()]).optional().nullable().transform((v, ctx) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 1e12) {
    ctx.addIssue({ code: "custom", message: "Must be a positive amount" });
    return z.NEVER;
  }
  return n;
});
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("").transform(() => null));

export const STAGES = ["idea", "research", "investigate", "validation", "build", "launch", "scale", "hold", "reject", "archive"] as const;
export type Stage = (typeof STAGES)[number];
export const TRACKS = ["cash", "balanced", "growth"] as const;
const track = z.preprocess((v) => (v === "" ? null : v), z.enum(TRACKS).nullable().optional());

export const ideaSchema = z.object({
  name: z.string().trim().min(3, "Give the idea a short name (3+ characters)").max(300),
  description: text(10000),
  targetMarket: text(1000),
  proposedPricing: text(1000),
  budgetAud: money,
  userEvidence: text(10000),
  relevantExperience: text(5000),
  notes: text(10000),
  track,
});
export type IdeaInput = z.infer<typeof ideaSchema>;

export const opportunityPatchSchema = z.object({
  name: z.string().trim().min(3).max(300).optional(),
  description: text(10000),
  coreHypothesis: text(5000),
  targetCustomer: text(2000),
  problem: text(5000),
  businessModels: text(5000),
  revenueMechanisms: text(5000),
  assumptions: text(10000),
  track,
  customerContact: text(200),
  targetMarket: text(1000),
  proposedPricing: text(1000),
  budgetAud: money,
  userEvidence: text(10000),
  relevantExperience: text(5000),
  notes: text(10000),
  primaryRisks: text(5000),
  competitorLeads: text(5000),
  nextAction: text(2000),
  nextReviewDate: date,
  owner: text(200),
  revenueAssumptions: text(5000),
  actualTestSpendAud: money,
  verifiedRevenueAud: money,
}).partial();

const evidence = z.enum(EVIDENCE_LEVELS.map((e) => e.key) as [string, ...string[]]);
export const scoreInputSchema = z.object({
  criteria: z.array(z.object({
    key: z.enum(CRITERIA.map((c) => c.key) as [string, ...string[]]),
    score: z.number().min(0).max(10).refine((x) => Math.abs(x * 10 - Math.round(x * 10)) < 1e-9, "Use at most one decimal place").nullable(),
    evidence,
    rationale: z.string().max(5000).optional().default(""),
  })).length(CRITERIA.length),
  gates: z.array(z.object({
    key: z.enum(GATES.map((g) => g.key) as [string, ...string[]]),
    status: z.enum(["satisfied", "unknown", "blocker"]),
    evidence,
    note: z.string().max(5000).optional().default(""),
  })).length(GATES.length),
});

export const stageChangeSchema = z.object({
  stage: z.enum(STAGES),
  reason: z.string().trim().min(3, "Record why the stage is changing").max(2000),
});

export const runwaySchema = z.object({
  savingsAud: z.number().min(0).max(1e9).nullable(),
  monthlyPersonalSpendAud: z.number().min(0).max(1e8).nullable(),
  resignationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currentSalaryAud: z.number().min(0).max(1e8).nullable(),
});
export type Runway = z.infer<typeof runwaySchema>;
