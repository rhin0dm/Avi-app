import ExcelJS from "exceljs";

/** A synthetic workbook with the same layout as the AVI Master Opportunity Register. */
export async function makeRegisterWorkbook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const reg = wb.addWorksheet("Opportunity Register");
  reg.addRow(["Rank", "Opportunity", "Track", "Initial score /100", "Test budget low AUD", "Test budget high AUD",
    "Customer contact", "Business concept", "Core hypothesis", "Evidence status", "Commercial validation status",
    "Decision status", "Next action", "Primary risks", "Competitor / source leads", "Evidence reference IDs", "Owner",
    "Last reviewed", "Next review", "Revenue assumptions", "Actual test spend AUD", "Verified revenue AUD", "Notes", "Custom column"]);
  reg.addRow([1, "Alpha document automation", "Balanced", 88, 500, 2500, "Low", "Extract documents", "Saves time",
    "Unverified", "Not started", "Investigate", "Pilot", "Accuracy", "Vendor A", "E01; E02", "Unassigned", "2026-11-01", "2026-11-15",
    "Illustrative only", 0, 0, "Note one", "keep me"]);
  reg.addRow([2, "Beta compliance alerts", "Growth", 81, 300, 2000, "Very low", "Monitor rules", "Recurring need",
    "Unverified", "Not started", "Hold", "Bulletins", "Liability", "Visualping", "E02", "Unassigned", "2026-11-01", "2026-12-01",
    "Illustrative only", 0, 0, null, null]);
  reg.addRow([3, "Gamma prompt packs", "Cash", 49, 50, 500, "Very low", "Sell prompts", "Low cost",
    "Unverified", "Not started", "Backlog", "Only if channel", "No moat", null, "E09", "Unassigned", null, null,
    null, 0, 0, null, null]);
  const ev = wb.addWorksheet("Evidence & Sources");
  ev.addRow(["Evidence ID", "Claim / finding", "Evidence classification", "Source / verification link", "Date / scope",
    "Confidence / limitations", "Relevant opportunities", "Action required"]);
  ev.addRow(["E01", "Context claim", "Market context (previous report; not reverified in this workbook)", "https://example.gov.au/", "2026", "Verify", "All", "Find report"]);
  ev.addRow(["E02", "Competitor exists", "Competitor lead", "javascript:alert(1)", "2026", "Check", "Beta", "Map"]);
  ev.addRow(["E03", "Unlinked evidence", "Official source to verify", "https://example.com/", "2026", "Check", "Gamma", "Verify"]);
  const ex = wb.addWorksheet("Experiment Log");
  ex.addRow(["Experiment ID", "Opportunity rank", "Hypothesis", "Test design", "Success metric", "Pass threshold", "Budget AUD",
    "Start date", "End date", "Status", "Actual spend AUD", "Result / evidence URL", "Decision", "Lessons / next action"]);
  ex.addRow(["EXP-001", 1, "Saves time", "Pilot 3", "Paid pilots", 3, 1000, null, null, "Planned", 0, null, "Pending", "Choose vertical"]);
  const intake = wb.addWorksheet("Idea Intake");
  intake.addRow(["ID", "Date", "Idea / niche", "Target buyer"]);
  intake.addRow(["AVI-026", "2026-11-01", "EXAMPLE ONLY — replace", "Unknown"]);
  const dh = wb.addWorksheet("Decision History");
  dh.addRow(["Date", "Idea ID", "Old score", "New score", "Old decision", "New decision", "Evidence / reason", "File version", "Owner"]);
  dh.addRow(["2026-11-01", "ALL", null, null, "Initial ranking", "Framework upgraded", "Added rubric", "v1.1", "AVI"]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
