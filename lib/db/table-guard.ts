import "server-only";

/**
 * True when a query failed because the table doesn't exist yet (migration not
 * applied). PGRST205 is PostgREST's "table not in schema cache"; 42P01 is
 * Postgres "undefined_table". Shared by lib/db/queries.ts and lib/log.ts so
 * every not-yet-migrated table degrades the same way instead of crashing.
 */
export function isMissingTableError(
  err: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST205" ||
    err.code === "42P01" ||
    (err.message ?? "").includes("schema cache")
  );
}

/**
 * True when a query failed because a COLUMN doesn't exist yet: the table is
 * migrated but a later migration that added the column isn't. 42703 is Postgres
 * "undefined_column"; PGRST204 is PostgREST's "column not found in schema
 * cache". Lets a query that filters on a new column fall back to the old
 * behavior instead of crashing on a partially-migrated database.
 */
export function isMissingColumnError(
  err: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!err) return false;
  return err.code === "42703" || err.code === "PGRST204";
}
