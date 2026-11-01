import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { parseDatedSteps } from "@/lib/docPlan";

describe("dated plan steps", () => {
  it("reads day/date tables, ranges and sections", () => {
    const md = `**As of:** 2026-11-01\n## Phase A — 3–7 Nov\n| Day | Date | Actions | Done when |\n|---|---|---|---|\n| 0 | Before 3 Nov | Get **consent** | Consent |\n| 1 | Mon 3 Nov | Clear 3 files | 3 timed |\n## Phase B\n| Day | Date | Actions | Done when |\n|---|---|---|---|\n| 6 | Sat–Sun 8–9 Nov | Soft-launch | ≥10 sends |\n| 9 | Wed 30 Dec | x | y |\n| 10 | Fri 2 Jan | Rollover | z |\n`;
    const s = parseDatedSteps(md);
    expect(s.map((x) => [x.start, x.end, x.section?.slice(0, 7)])).toEqual([
      ["2026-11-03", "2026-11-03", "Phase A"], ["2026-11-03", "2026-11-03", "Phase A"], ["2026-11-08", "2026-11-09", "Phase B"],
      ["2026-12-30", "2026-12-30", "Phase B"], ["2027-01-02", "2027-01-02", "Phase B"]]);
    expect(s[0]).toMatchObject({ before: true, action: "Get consent" });
  });
  const f = "local-data/f64a919b-AVI-002_EXP-002r1_day_plan_v1.0.md";
  it.runIf(existsSync(f))("reads the owner's EXP-002r1 day plan", () => {
    const s = parseDatedSteps(readFileSync(f, "utf8"));
    expect(s.length).toBe(10);
    expect(s[0].dateText).toBe("Before 3 Nov");
    expect(s.at(-1)).toMatchObject({ start: "2026-11-14", end: "2026-11-16" });
  });
});
