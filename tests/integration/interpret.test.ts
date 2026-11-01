// AI interpretation job lifecycle, with the provider's HTTP API stubbed.
// This proves the job/status/parsing code; it does not prove a live API call.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDb, TEST_DATABASE_URL } from "../helpers/db";

process.env.DATABASE_URL = TEST_DATABASE_URL;
const { getSql } = await import("@/lib/db");
const repo = await import("@/lib/repo");
const { runInterpretation } = await import("@/lib/ai/interpret");
const sql = getSql();

const idea = { name: "Tender alerts for electricians", description: "Weekly alerts", targetMarket: null, proposedPricing: null, budgetAud: null,
  userEvidence: null, relevantExperience: null, notes: null, track: null };
const good = { summary: "s", targetCustomer: "Electrical contractors", problem: "Missed tenders", businessModels: ["Subscription"],
  revenueMechanisms: ["Monthly fee"], assumptionsToInvestigate: ["Will pay"], keyRisks: ["Coverage"], clarifyingQuestions: ["Which states?"] };

beforeAll(resetTestDb);
afterAll(() => { vi.unstubAllGlobals(); delete process.env.ANTHROPIC_API_KEY; });

describe("interpretation jobs", () => {
  it("without a key the idea stays saved and is marked not configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { opportunity } = await repo.createOpportunity(idea);
    expect((await runInterpretation(opportunity.id)).status).toBe("not_configured");
    const [o] = await sql`select interpretation_status from opportunities where id = ${opportunity.id}`;
    expect(o.interpretationStatus).toBe("not_configured");
  });

  it("parses a provider response, stores it as inference and completes the job", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "Here:\n" + JSON.stringify(good) }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { opportunity } = await repo.createOpportunity({ ...idea, name: "Tender alerts for plumbers" });
    const r = await runInterpretation(opportunity.id);
    expect(r.status).toBe("completed");
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.anthropic.com/v1/messages");
    expect((call[1].headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    const [o] = await sql`select interpretation, interpretation_status, target_customer from opportunities where id = ${opportunity.id}`;
    expect(o.interpretationStatus).toBe("completed");
    expect(o.interpretation.evidenceClass).toBe("inference");
    expect(o.targetCustomer).toBeNull(); // never written into owner fields automatically
    const [job] = await sql`select status from jobs where opportunity_id = ${opportunity.id}`;
    expect(job.status).toBe("completed");
  });

  it("records a failed job when the provider errors or returns junk", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("overloaded", { status: 529 })));
    const { opportunity } = await repo.createOpportunity({ ...idea, name: "Tender alerts for builders" });
    const r = await runInterpretation(opportunity.id);
    expect(r.status).toBe("failed");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "{\"summary\": 5}" }] }), { status: 200 })));
    expect((await runInterpretation(opportunity.id)).status).toBe("failed");
    const jobs = await sql`select status, error from jobs where opportunity_id = ${opportunity.id}`;
    expect(jobs.map((j) => j.status)).toEqual(["failed", "failed"]);
    expect(jobs[0].error).toMatch(/529/);
  });
});
