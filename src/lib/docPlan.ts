// Pulls dated steps out of a plan written as Markdown tables, e.g.
// | Day | Date | Actions | Done when |  with dates like "Mon 3 Nov", "Sat–Sun 8–9 Nov", "Before 3 Nov".
export type PlanStep = { start: string; end: string; dateText: string; section: string | null; action: string; doneWhen: string | null; before: boolean };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const clean = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function parseDatedSteps(md: string, fallbackDate: Date = new Date()): PlanStep[] {
  const year = Number(md.match(/\b(20\d{2})-\d{2}-\d{2}\b/)?.[1] ?? md.match(/\b(20\d{2})\b/)?.[1] ?? fallbackDate.getUTCFullYear());
  const lines = md.split(/\r?\n/);
  const steps: PlanStep[] = [];
  let section: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{2,4}\s+(.+)$/);
    if (h) { section = clean(h[1]); continue; }
    if (!lines[i].trim().startsWith("|")) continue;
    const head = cells(lines[i]).map((c) => c.toLowerCase());
    const di = head.findIndex((c) => c === "date" || c === "when");
    const ai = head.findIndex((c) => /^(actions?|task|step|what)$/.test(c));
    if (di < 0 || ai < 0 || !/^\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) continue;
    const doneI = head.findIndex((c) => c.startsWith("done"));
    let j = i + 2;
    let prevMonth: number | null = null;
    for (; j < lines.length && lines[j].trim().startsWith("|"); j++) {
      const row = cells(lines[j]);
      const dateText = clean(row[di] ?? "");
      const m = dateText.match(/(\d{1,2})(?:\s*[–—-]\s*(\d{1,2}))?\s+([A-Za-z]{3})/);
      const mon = m ? MONTHS.indexOf(m[3].toLowerCase()) : -1;
      if (!m || mon < 0) continue;
      // a plan that runs Dec → Jan rolls the year over
      const y = prevMonth !== null && mon < prevMonth ? year + 1 : year;
      prevMonth = mon;
      const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
      steps.push({
        start: iso(y, mon, a), end: iso(y, mon, b), dateText, section,
        action: clean(row[ai] ?? ""), doneWhen: doneI >= 0 ? clean(row[doneI] ?? "") || null : null, before: /^before\b/i.test(dateText),
      });
    }
    i = j - 1;
  }
  return steps;
}
