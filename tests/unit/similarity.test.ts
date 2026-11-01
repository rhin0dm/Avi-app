import { describe, expect, it } from "vitest";
import { findSimilar } from "@/lib/similarity";

const pool = [
  { id: "1", code: "AVI-006", name: "Supplier invoice and price-change intelligence", description: "Detect price increases, anomalies and duplicate charges" },
  { id: "2", code: "AVI-016", name: "AI-assisted niche ebook portfolio", description: "Publish specialist books and companion products" },
  { id: "3", code: "AVI-002", name: "Bookkeeping exception-management software", description: "Flag missing receipts, unclear transactions and reconciliation exceptions" },
];

describe("duplicate detection", () => {
  it("flags the brief's example idea against the existing supplier-price opportunity", () => {
    const r = findSimilar("Supplier price-increase detector for builders", "AI software that identifies unexplained supplier price increases for Australian construction companies.", pool);
    expect(r[0]?.code).toBe("AVI-006");
    expect(r.map((x) => x.code)).not.toContain("AVI-016");
  });
  it("exact names (ignoring case/punctuation) score 1", () => {
    expect(findSimilar("bookkeeping exception management software", null, pool)[0]).toMatchObject({ code: "AVI-002", similarity: 1, exact: true });
  });
  it("unrelated ideas are not flagged", () => {
    expect(findSimilar("Dog walking marketplace", "Connect owners with walkers", pool)).toEqual([]);
  });
});
