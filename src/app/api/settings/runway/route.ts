import { NextResponse } from "next/server";
import { handle, readJson } from "@/lib/api";
import { saveRunway } from "@/lib/repo";
import { runwaySchema } from "@/lib/validation";

export const POST = handle(async (req: Request) => {
  await saveRunway(runwaySchema.parse(await readJson(req)));
  return NextResponse.json({ ok: true });
});
