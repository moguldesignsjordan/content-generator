"use client";

import { cn } from "@/lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
  size = "md",
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-surface-2 p-1",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-full font-medium transition-colors",
              size === "sm" ? "h-8 px-3.5 text-[13px]" : "h-9 px-4 text-[13px]",
              active
                ? "bg-surface text-foreground shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_4px_12px_-6px_rgba(0,0,0,0.6)]"
                : "text-muted hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
