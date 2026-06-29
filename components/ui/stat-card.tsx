import * as React from "react";
import { cn } from "@/lib/cn";
import { Card } from "./card";

/**
 * Compact stat tile. Number stays solid Paper (crisp, high-contrast); the
 * spectrum appears as a thin accent bar, never as gradient text. Deliberately
 * not the oversized hero-metric cliché.
 */
export function StatCard({
  label,
  value,
  sub,
  className,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      className={cn(
        "p-4",
        onClick && "cursor-pointer transition-colors hover:bg-surface-2",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="bar-spectrum h-1 w-5 rounded-full" />
        <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-muted">
          {label}
        </span>
      </div>
      <div className="mt-2.5 font-display text-[32px] font-semibold leading-none tabular-nums text-foreground">
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[13px] text-muted">{sub}</div>}
    </Card>
  );
}
