export function money(n: number | null | undefined, currency = "AUD", digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}
export function num(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-AU", { maximumFractionDigits: digits }).format(n);
}
export function pct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return `${Math.round(Number(n) * 100)}%`;
}
export function date(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d.length === 10 ? d + "T00:00:00" : d) : d;
  return x.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}
export function isoDay(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  // dates from Postgres arrive as local-midnight Date objects
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const STAGE_LABEL: Record<string, string> = {
  idea: "Idea", research: "Research", investigate: "Investigate", validation: "Validation", build: "Build",
  launch: "Launch", scale: "Scale", hold: "Hold", reject: "Reject", archive: "Archive",
};

/** Hostname for display; never throws on a malformed URL. */
export function host(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
