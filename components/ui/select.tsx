import * as React from "react";
import { cn } from "@/lib/cn";

const CONTROL =
  "w-full rounded-[var(--radius-md)] border border-border bg-surface-2 " +
  "px-3.5 text-[15px] text-foreground transition " +
  "focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none " +
  "disabled:opacity-50";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(CONTROL, "h-11", className)} {...props}>
      {children}
    </select>
  );
});
