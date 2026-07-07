"use client";

import { useEffect, useRef, useState } from "react";
import type { AppLog, AppLogLevel } from "@/lib/db/types";

const POLL_MS = 2500;
const MAX_ROWS = 500;

async function fetchLogs(params: URLSearchParams): Promise<AppLog[]> {
  const res = await fetch(`/api/logs/recent?${params.toString()}`);
  if (!res.ok) return [];
  const { logs } = (await res.json()) as { logs: AppLog[] };
  return logs;
}

/**
 * Polls /api/logs/recent every ~2.5s for the /logs page. `initialLogs` (the
 * server-rendered, unfiltered feed) seeds the first paint; switching `level`
 * refetches from scratch since the server only pre-renders the "All" feed.
 * After that, each tick asks only for rows newer than the last one seen
 * (`since`), merges them in newest-first, and caps state at MAX_ROWS.
 */
export function useLogsPoll(initialLogs: AppLog[], level?: AppLogLevel): AppLog[] {
  const [logs, setLogs] = useState<AppLog[]>(initialLogs);
  const cursorRef = useRef<string | undefined>(initialLogs[0]?.created_at);
  const skipInitialReload = useRef(true);

  useEffect(() => {
    let cancelled = false;

    async function reload() {
      const params = new URLSearchParams();
      if (level) params.set("level", level);
      const fresh = await fetchLogs(params);
      if (cancelled) return;
      setLogs(fresh);
      cursorRef.current = fresh[0]?.created_at;
    }

    if (skipInitialReload.current && !level) {
      skipInitialReload.current = false;
    } else {
      skipInitialReload.current = false;
      reload();
    }

    const timer = setInterval(async () => {
      const params = new URLSearchParams();
      if (cursorRef.current) params.set("since", cursorRef.current);
      if (level) params.set("level", level);
      const fresh = await fetchLogs(params);
      if (cancelled || !fresh.length) return;
      cursorRef.current = fresh[fresh.length - 1].created_at;
      setLogs((prev) => [...fresh].reverse().concat(prev).slice(0, MAX_ROWS));
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [level]);

  return logs;
}
