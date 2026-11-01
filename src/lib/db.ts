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
