import "server-only";

// Server-only DataForSEO client (mirrors lib/clients/gemini-image.ts: env-var
// key, isXConfigured() for graceful degradation). Basic Auth (email/password),
// not OAuth. Base host is overridable so a dev can point at
// sandbox.dataforseo.com without a code change.
//
// Endpoint shapes verified against docs.dataforseo.com (2026-07): every v3
// endpoint takes a POST body that is an ARRAY of task objects (even for one
// task), and returns { tasks: [{ result: [...] }] }. "Labs" endpoints
// (dataforseo_labs/*) nest their payload one level deeper, as
// result[0].items[]; plain "keywords_data" endpoints return result[] as a
// flat per-keyword array. lib/keyword/research.ts handles both shapes.

const HOST = process.env.DATAFORSEO_HOST ?? "api.dataforseo.com";

function credentials(): { login: string; password: string } | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return { login, password };
}

export function isDataForSeoConfigured(): boolean {
  return credentials() !== null;
}

export interface DataForSeoTask<T> {
  id: string;
  status_code: number;
  status_message: string;
  cost: number;
  result_count: number;
  result: T[] | null;
}

export interface DataForSeoResponse<T> {
  status_code: number;
  status_message: string;
  cost: number;
  tasks_count: number;
  tasks_error: number;
  tasks: DataForSeoTask<T>[] | null;
}

/**
 * Low-level POST to one DataForSEO v3 endpoint (e.g.
 * "keywords_data/google_ads/search_volume/live"). `tasks` is the array of
 * task-payload objects DataForSEO expects, one per keyword batch.
 */
export async function postTasks<T = unknown>(
  endpoint: string,
  tasks: Record<string, unknown>[],
): Promise<DataForSeoResponse<T>> {
  const creds = credentials();
  if (!creds) {
    throw new Error(
      "DataForSEO is not configured. Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to .env.local.",
    );
  }
  const auth = Buffer.from(`${creds.login}:${creds.password}`).toString("base64");
  const res = await fetch(`https://${HOST}/v3/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(tasks),
  });
  const data = (await res.json()) as DataForSeoResponse<T>;
  if (!res.ok || data.status_code !== 20000) {
    throw new Error(
      `DataForSEO ${endpoint} failed: ${data.status_message ?? res.statusText}`,
    );
  }
  return data;
}
