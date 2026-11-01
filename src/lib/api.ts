import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UserError } from "./repo";

/** Wraps a route handler with consistent JSON errors. Internal errors are logged, not leaked. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ZodError) {
        return NextResponse.json({ error: "Invalid input", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
      }
      if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
      console.error(e);
      return NextResponse.json({ error: "Something went wrong on the server. Check the server logs." }, { status: 500 });
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 1_000_000) throw new UserError("Request too large");
  try {
    return await req.json();
  } catch {
    throw new UserError("Request body must be JSON");
  }
}
