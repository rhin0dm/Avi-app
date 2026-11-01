import "server-only";
import postgres, { type Sql } from "postgres";

const g = globalThis as unknown as { __aviSql?: Sql };

export function getSql(): Sql {
  if (!g.__aviSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not configured");
    g.__aviSql = postgres(url, {
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      // column names only; JSON contents (weights, imported rows) keep their original keys
      transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },
      prepare: false, // required for Supabase's transaction-mode pooler
      onnotice: () => {},
      types: {
        // numeric → JS number (amounts are well inside double precision)
        numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
      },
    });
  }
  return g.__aviSql;
}

const r = globalThis as unknown as { __aviReady?: Promise<void> };

/**
 * Applies any pending migrations (embedded at build time) once per server instance,
 * so schema updates deploy with the code — no manual SQL needed.
 */
export function ready(): Promise<void> {
  if (!r.__aviReady) {
    r.__aviReady = applyMigrations(getSql()).catch((e) => {
      r.__aviReady = undefined;
      throw e;
    });
  }
  return r.__aviReady;
}

async function applyMigrations(sql: Sql) {
  const { MIGRATIONS } = await import("./migrations.generated");
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())`;
  const done = new Set((await sql`select name from schema_migrations`).map((x) => x.name as string));
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue;
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(4729110)`; // one instance migrates at a time
      const [already] = await tx`select 1 from schema_migrations where name = ${m.name}`;
      if (already) return;
      await tx.unsafe(m.sql);
      await tx`insert into schema_migrations (name) values (${m.name})`;
    });
  }
}
