import * as React from "react";
import { cn } from "@/lib/cn";

export type BadgeTone =
  | "neutral"
  | "amber"
  | "magenta"
  | "violet"
  | "cyan"
  | "success"
  | "warning"
  | "danger";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-white/[0.06] text-muted border-white/[0.06]",
  amber: "bg-amber/15 text-amber border-amber/20",
  magenta: "bg-magenta/15 text-magenta border-magenta/25",
  violet: "bg-violet/15 text-violet border-violet/25",
  cyan: "bg-cyan/15 text-cyan border-cyan/25",
  success: "bg-success/15 text-success border-success/25",
  warning: "bg-warning/15 text-warning border-warning/25",
  danger: "bg-danger/15 text-danger border-danger/25",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
}

/** Small spectral/semantic pill. 12% tint bg + matching text + hairline. */
export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 " +
          "text-[11px] font-medium leading-none",
        TONES[tone],
        className,
      )}
      {...props}
    >
      {dot && (
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-90" />
      )}
      {children}
    </span>
  );
}
