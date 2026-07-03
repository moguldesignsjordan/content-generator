// Snapshot / restore the entire content database to/from a JSON file, so the
// fresh-user walkthrough (delete from brands) is reversible. Rows keep their
// UUIDs, so restore re-inserts in FK order and everything relinks.
//
//   npx tsx --env-file=.env.local db/snapshot.ts save
//   npx tsx --env-file=.env.local db/snapshot.ts restore db/backups/<file>.json
//
// (Run with NODE_PATH pointing at a server-only stub if outside Next.)
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// FK-safe insert order (reverse for conceptual delete; delete from brands
// cascades anyway).
const TABLES = [
  "brands",
  "strategies",
  "icps",
  "pillars",
  "clusters",
  "topics",
  "products",
  "campaigns",
  "content_jobs",
  "drafts",
  "approvals",
  "publications",
  "performance",
] as const;

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE env vars (.env.local)");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function save() {
  const client = db();
  const snapshot: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    const { data, error } = await client.from(table).select("*");
    if (error) {
      // Tables from unapplied migrations just snapshot as empty.
      console.warn(`⚠ ${table}: ${error.message} (saved as empty)`);
      snapshot[table] = [];
      continue;
    }
    snapshot[table] = data ?? [];
    console.log(`✓ ${table}: ${data?.length ?? 0} rows`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `db/backups/snapshot-${stamp}.json`;
  writeFileSync(file, JSON.stringify(snapshot, null, 2));
  console.log(`\nSaved ${file}`);
}

async function restore(file: string) {
  const client = db();
  const snapshot = JSON.parse(readFileSync(file, "utf-8")) as Record<
    string,
    Record<string, unknown>[]
  >;
  for (const table of TABLES) {
    const rows = snapshot[table] ?? [];
    if (!rows.length) continue;
    // Upsert on id so restore is idempotent and tolerates partial re-runs.
    const { error } = await client.from(table).upsert(rows, { onConflict: "id" });
    if (error) throw new Error(`${table}: ${error.message}`);
    console.log(`✓ restored ${table}: ${rows.length} rows`);
  }
  console.log("\nRestore complete.");
}

const [mode, file] = process.argv.slice(2);
if (mode === "save") {
  save();
} else if (mode === "restore" && file) {
  restore(file);
} else {
  console.log("usage: tsx db/snapshot.ts save | restore <file>");
  process.exit(1);
}
