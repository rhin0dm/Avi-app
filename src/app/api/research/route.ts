import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { getSql } from "@/lib/db";
import { checkBriefUpload, commitBriefImport, commitDocument, isResearchBrief, planBriefImport, planDocument, MAX_BRIEF_BYTES } from "@/lib/briefImport";
import { UserError } from "@/lib/repo";

export const maxDuration = 60;

export const POST = handle(async (req: Request) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BRIEF_BYTES + 100_000) throw new UserError("Research brief is larger than 1 MB.");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new UserError("Attach a research brief (.md)");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = checkBriefUpload(file.name, bytes);
  if (problem) throw new UserError(problem);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new UserError("The file isn't readable text (UTF-8).");
  }
  const sql = getSql();
  const name = file.name.slice(0, 200);
  if (!isResearchBrief(text)) {
    if (form.get("mode") !== "commit") return NextResponse.json({ mode: "preview", plan: await planDocument(sql, text, name) });
    const analyst = String(form.get("analyst") ?? "").trim() || undefined;
    return NextResponse.json({ mode: "commit", summary: await commitDocument(sql, text, name, analyst) });
  }
  if (form.get("mode") !== "commit") return NextResponse.json({ mode: "preview", plan: await planBriefImport(sql, text) });
  const analyst = String(form.get("analyst") ?? "").trim() || undefined;
  const summary = await commitBriefImport(sql, text, { createChild: form.get("createChild") === "1", analyst });
  return NextResponse.json({ mode: "commit", summary });
});
