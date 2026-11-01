import postgres from "postgres";
import { migrate } from "../../scripts/migrate";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/avi_test";

/** Drops and recreates the test schema, then applies all migrations. */
export async function resetTestDb() {
  const admin = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe("drop schema public cascade; create schema public;");
  await admin.end();
  await migrate(TEST_DATABASE_URL, () => {});
}
