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
