"use client";

import { useState } from "react";
import { Badge, Card, SegmentedControl, type BadgeTone } from "@/components/ui";
import { useLogsPoll } from "@/lib/use-logs-poll";
import type { AppLog, AppLogLevel } from "@/lib/db/types";

type Filter = AppLogLevel | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "error", label: "Errors" },
  { value: "warn", label: "Warnings" },
  { value: "usage", label: "Usage" },
];

const LEVEL_TONE: Record<AppLogLevel, BadgeTone> = {
  error: "danger",
  warn: "warning",
  info: "cyan",
  usage: "violet",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function LogRow({ log }: { log: AppLog }) {
  const hasContext = log.context && Object.keys(log.context).length > 0;
  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <Badge tone={LEVEL_TONE[log.level]}>{log.level}</Badge>
        <span className="truncate text-[13px] font-medium text-foreground">
          {log.source}
        </span>
        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-2">
          {formatTime(log.created_at)}
        </span>
      </div>

      {log.level === "usage" ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-2">
          <span>{log.model}</span>
          <span>in {(log.input_tokens ?? 0).toLocaleString()}</span>
          <span>out {(log.output_tokens ?? 0).toLocaleString()}</span>
          {!!log.cache_read_input_tokens && (
            <span>cache-read {log.cache_read_input_tokens.toLocaleString()}</span>
          )}
          {!!log.cache_creation_input_tokens && (
            <span>cache-write {log.cache_creation_input_tokens.toLocaleString()}</span>
          )}
          <span className="font-medium text-foreground">
            ${(log.estimated_usd ?? 0).toFixed(4)}
          </span>
        </div>
      ) : (
        <p className="text-[13px] text-muted">{log.message}</p>
      )}

      {hasContext && log.level !== "usage" && (
        <pre className="mt-0.5 max-h-40 overflow-auto rounded-md bg-surface-2 px-2.5 py-1.5 text-[11px] text-muted-2">
          {JSON.stringify(log.context, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function LogsFeed({ initialLogs }: { initialLogs: AppLog[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const logs = useLogsPoll(initialLogs, filter === "all" ? undefined : filter);

  return (
    <div>
      <div className="mb-4">
        <SegmentedControl value={filter} onChange={setFilter} options={FILTERS} />
      </div>
      {logs.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">
          No log activity yet.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {logs.map((log) => (
            <LogRow key={log.id} log={log} />
          ))}
        </Card>
      )}
    </div>
  );
}
