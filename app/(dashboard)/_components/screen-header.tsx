import * as React from "react";
import { cn } from "@/lib/cn";

/** Large in-flow screen title with optional subtitle and trailing actions. */
export function ScreenHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6", className)}>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[28px] font-semibold leading-[1.1] tracking-tight text-foreground md:text-[34px]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}
