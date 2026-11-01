// Deterministic duplicate detection (no AI needed): token overlap on names
// and descriptions after normalisation.

const STOP = new Set([
  "a", "an", "and", "the", "of", "for", "to", "in", "on", "with", "by", "or", "that", "which", "from", "at", "as",
  "is", "are", "be", "ai", "based", "powered", "assisted", "tool", "tools", "software", "service", "services",
  "platform", "app", "business", "businesses", "australian", "small", "niche", "specialist",
]);

export function normalizeName(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 6 && (w.endsWith("or") || w.endsWith("er"))) return w.slice(0, -2);
  if (w.length > 6 && w.endsWith("ion")) return w.slice(0, -3);
  return w;
}

export function tokens(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(normalizeName(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w)).map(stem));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Share of the smaller set that overlaps; needs 2+ shared words to count. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size < 2 || b.size < 2) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter < 2 ? 0 : inter / Math.min(a.size, b.size);
}

export type SimilarityCandidate = { id: string; code: string; name: string; description: string | null };

export function findSimilar(
  name: string,
  description: string | null | undefined,
  pool: SimilarityCandidate[],
  threshold = 0.3,
) {
  const n = normalizeName(name);
  const nameT = tokens(name);
  const allT = tokens(`${name} ${description ?? ""}`);
  return pool
    .map((p) => {
      const exact = normalizeName(p.name) === n;
      const score = exact
        ? 1
        : (() => {
            const pName = tokens(p.name);
            const pAll = tokens(`${p.name} ${p.description ?? ""}`);
            return Math.max(jaccard(nameT, pName), 0.8 * overlap(nameT, pName), 0.85 * jaccard(allT, pAll), 0.7 * overlap(allT, pAll));
          })();
      return { ...p, similarity: Math.round(score * 100) / 100, exact };
    })
    .filter((p) => p.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);
}
