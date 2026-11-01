import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { rescoreAll } from "@/lib/repo";

export const POST = handle(async () => NextResponse.json(await rescoreAll()));
