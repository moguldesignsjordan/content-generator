import * as React from "react";
import { cn } from "@/lib/cn";

/** A Carbon surface with a hairline border and generous radius. */
export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-border bg-surface",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** A tighter inner surface used for nested fields/preview areas. */
export function CardBody({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("p-5", className)} {...props}>
      {children}
    </div>
  );
}
