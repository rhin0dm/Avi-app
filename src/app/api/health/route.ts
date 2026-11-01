import { NextResponse } from "next/server";
import postgres from "postgres";

export const dynamic = "force-dynamic";

/** Public health check. Reports why the database is unreachable, never the password. */
export async function GET() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return NextResponse.json({ ok: false, database: "unreachable", reason: "DATABASE_URL is not set in Vercel" }, { status: 503 });

  const value = raw.trim();
  let info: Record<string, unknown> = {};
  try {
    const u = new URL(value);
    info = {
      scheme: u.protocol.replace(":", ""),
      user: decodeURIComponent(u.username),
      host: u.hostname,
      port: u.port || "(none)",
      database: u.pathname.replace("/", "") || "(none)",
      passwordLength: decodeURIComponent(u.password).length,
      passwordStillPlaceholder: /YOUR-PASSWORD|\[|\]/i.test(decodeURIComponent(u.password)),
      hadSpacesOrQuotes: raw !== value || /^["']|["']$/.test(value),
    };
  } catch {
    return NextResponse.json({ ok: false, database: "unreachable", reason: "DATABASE_URL is not a valid connection string (it should start with postgresql://)" }, { status: 503 });
  }

  const sql = postgres(value, { max: 1, prepare: false, connect_timeout: 8, onnotice: () => {} });
  try {
    await sql`select 1`;
    return NextResponse.json({ ok: true, database: "reachable" });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const msg = String(err.message ?? "").replace(/postgres(ql)?:\/\/[^\s]+/gi, "[connection string]");
    let reason = `${err.code ?? "error"}: ${msg}`.slice(0, 300);
    if (/password authentication failed|28P01/i.test(msg + err.code)) reason = "Wrong password in DATABASE_URL";
    else if (/tenant or user not found/i.test(msg)) reason = "Supabase doesn't recognise the user name — it should look like postgres.yourprojectref";
    else if (err.code === "ENOTFOUND") reason = "Host name not found — check the part after the @";
    else if (err.code === "ETIMEDOUT" || err.code === "ECONNREFUSED" || /timeout/i.test(msg)) reason = "Could not connect in time — check the host and port (6543)";
    return NextResponse.json({ ok: false, database: "unreachable", reason, info }, { status: 503 });
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}
