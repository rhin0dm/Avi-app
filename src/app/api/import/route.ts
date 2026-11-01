import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { getSql } from "@/lib/db";
import { checkUpload, commitImport, planImport, MAX_UPLOAD_BYTES } from "@/lib/importer";
import { UserError } from "@/lib/repo";

export const maxDuration = 60;

export const POST = handle(async (req: Request) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 100_000) throw new UserError("File is larger than 10 MB.");
  const form = await req.formData();
  const file = form.get("file");
  const mode = form.get("mode") === "commit" ? "commit" : "preview";
  if (!(file instanceof File)) throw new UserError("Attach an .xlsx file");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = checkUpload(file.name, bytes);
  if (problem) throw new UserError(problem);
  const sql = getSql();
  let plan;
  try {
    plan = await planImport(sql, bytes);
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : "Could not read workbook");
  }
  if (mode === "preview") return NextResponse.json({ mode, plan });
  const summary = await commitImport(sql, plan, file.name.slice(0, 200));
  return NextResponse.json({ mode, summary });
});
