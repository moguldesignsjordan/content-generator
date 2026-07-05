import { cn } from "@/lib/cn";

export type ProgressVariant = "bar" | "ring";

export interface ProgressProps {
  variant?: ProgressVariant;
  value?: number;
  max?: number;
  indeterminate?: boolean;
  label?: string;
  className?: string;
  /** Ring diameter in px (ring variant only). */
  size?: number;
}

/** Determinate/indeterminate progress indicator, bar or ring. */
export function Progress({
  variant = "bar",
  value = 0,
  max = 100,
  indeterminate = false,
  label,
  className,
  size = 48,
}: ProgressProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));

  if (variant === "ring") {
    const stroke = 4;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = indeterminate
      ? circumference * 0.75
      : circumference - (pct / 100) * circumference;

    return (
      <div
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className={cn("inline-flex items-center justify-center", className)}
        style={{ width: size, height: size }}
      >
        <svg
          width={size}
          height={size}
          className={indeterminate ? "animate-spin" : undefined}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
            fill="none"
            className="stroke-white/10"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className="stroke-accent transition-[stroke-dashoffset] duration-500 ease-out"
          />
        </svg>
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <div
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={cn(
            "h-full rounded-full bg-spectrum",
            indeterminate
              ? "w-1/3 animate-[progress-indeterminate_1.3s_ease-in-out_infinite]"
              : "transition-[width] duration-500 ease-out",
          )}
          style={!indeterminate ? { width: `${pct}%` } : undefined}
        />
      </div>
      {label && <p className="mt-2 text-[13px] text-muted">{label}</p>}
    </div>
  );
}
