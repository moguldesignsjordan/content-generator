import { cn } from "@/lib/cn";

export type SkeletonVariant = "text" | "rect" | "circle";

export interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: number | string;
  height?: number | string;
  className?: string;
}

const VARIANT_CLS: Record<SkeletonVariant, string> = {
  text: "rounded-[6px] h-3.5",
  rect: "rounded-[var(--radius-md)]",
  circle: "rounded-full",
};

/** Loading placeholder. Pass width/height for rect/circle; text defaults to a full-width line. */
export function Skeleton({
  variant = "text",
  width,
  height,
  className,
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block animate-pulse bg-surface-2",
        variant === "text" && !width && "w-full",
        VARIANT_CLS[variant],
        className,
      )}
      style={{
        width,
        height: height ?? (variant === "circle" ? width : undefined),
      }}
    />
  );
}
