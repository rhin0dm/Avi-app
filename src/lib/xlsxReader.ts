// Minimal, tolerant .xlsx reader: values only (cached formula results, never
// evaluated). Handles namespace-prefixed XML (e.g. files written by the
// OpenXML SDK) that some libraries reject. Untrusted input: size-limited.
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export type SheetData = { name: string; rows: (string | number | null)[][] };
export type Cell = string | number | null;

const MAX_UNCOMPRESSED = 100 * 1024 * 1024;
const MAX_ROWS = 20000;
const MAX_COLS = 200;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  textNodeName: "#text",
  isArray: (name) => ["sheet", "Relationship", "si", "r", "row", "c"].includes(name),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type X = any;

/** Numeric character references (&#8212; &#x2014;) that the XML parser leaves encoded. */
function decodeRefs(s: string): string {
  if (!s.includes("&#")) return s;
  return s.replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (m, hex, dec) => {
    const cp = hex ? parseInt(hex, 16) : Number(dec);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

function text(node: X): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string" || typeof node === "number") return decodeRefs(String(node));
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "object") {
    if ("#text" in node) return decodeRefs(String(node["#text"]));
    if ("t" in node || "r" in node) return text(node.t) + text(node.r);
  }
  return "";
}

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function readXlsx(bytes: Uint8Array): Promise<SheetData[]> {
  const zip = await JSZip.loadAsync(bytes);
  let total = 0;
  zip.forEach((_p, f) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    total += (f as any)._data?.uncompressedSize ?? 0;
  });
  if (total > MAX_UNCOMPRESSED) throw new Error("Workbook is too large when uncompressed.");

  const read = async (path: string) => {
    const f = zip.file(path) ?? zip.file(path.replace(/^\//, ""));
    return f ? f.async("string") : null;
  };
  const wbXml = await read("xl/workbook.xml");
  const relsXml = await read("xl/_rels/workbook.xml.rels");
  if (!wbXml || !relsXml) throw new Error("Not an Excel workbook (missing workbook.xml).");

  const wb = parser.parse(wbXml).workbook;
  const rels: X[] = parser.parse(relsXml).Relationships?.Relationship ?? [];
  const target = (id: string) => {
    const t = rels.find((r) => r["@_Id"] === id)?.["@_Target"] as string | undefined;
    if (!t) return null;
    return t.startsWith("/") ? t.slice(1) : `xl/${t.replace(/^\.\//, "")}`;
  };

  const ssXml = await read("xl/sharedStrings.xml");
  const shared: string[] = ssXml ? (parser.parse(ssXml).sst?.si ?? []).map((si: X) => text(si)) : [];

  const out: SheetData[] = [];
  for (const s of wb.sheets?.sheet ?? []) {
    const name = String(s["@_name"]);
    const rid = s["@_id"] ?? s["@_r:id"];
    const path = rid ? target(rid) : null;
    const xml = path ? await read(path) : null;
    if (!xml) continue;
    const rowsXml: X[] = parser.parse(xml).worksheet?.sheetData?.row ?? [];
    const rows: Cell[][] = [];
    for (const r of rowsXml.slice(0, MAX_ROWS)) {
      const rn = Number(r["@_r"] ?? rows.length + 1) - 1;
      if (rn >= MAX_ROWS) break;
      const row: Cell[] = [];
      let nextCol = 0;
      for (const c of r.c ?? []) {
        const ci = c["@_r"] ? colIndex(c["@_r"]) : nextCol;
        nextCol = ci + 1;
        if (ci >= MAX_COLS) continue;
        const t = c["@_t"];
        let v: Cell = null;
        if (t === "s") v = shared[Number(text(c.v))] ?? null;
        else if (t === "inlineStr") v = text(c.is);
        else if (t === "str" || t === "e") v = t === "e" ? null : text(c.v);
        else if (t === "b") v = text(c.v) === "1" ? "TRUE" : "FALSE";
        else if (c.v !== undefined) {
          const raw = text(c.v);
          const n = Number(raw);
          v = raw !== "" && Number.isFinite(n) ? n : raw || null;
        }
        if (typeof v === "string") v = v.trim() === "" ? null : v;
        row[ci] = v;
      }
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
      rows[rn] = row;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    out.push({ name, rows });
  }
  return out;
}
