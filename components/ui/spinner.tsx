import { cn } from "@/lib/cn";

export function Spinner({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label="Loading"
      style={{ width: size, height: size }}
      className={cn(
        "inline-block animate-spin rounded-full border-2 border-white/25 " +
          "border-t-white",
        className,
      )}
    />
  );
}

/** Magenta-tinted spinner for use on light/solid buttons. */
export function AccentSpinner({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label="Loading"
      style={{ width: size, height: size }}
      className={cn(
        "inline-block animate-spin rounded-full border-2 border-accent/30 " +
          "border-t-accent",
        className,
      )}
    />
  );
}
