"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

const SIDE_CLS: Record<"top" | "bottom" | "left" | "right", string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

export interface TooltipProps {
  side?: "top" | "bottom" | "left" | "right";
  label?: string;
  content?: React.ReactNode;
  children: React.ReactElement<{ "aria-describedby"?: string }>;
  className?: string;
}

/** Hover/focus tooltip. Wraps a single child and attaches aria-describedby. */
export function Tooltip({
  side = "top",
  label,
  content,
  children,
  className,
}: TooltipProps) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);

  const show = () => setOpen(true);
  const hide = () => setOpen(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {React.cloneElement(children, { "aria-describedby": id })}
      <span
        role="tooltip"
        id={id}
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-[var(--radius-sm)] " +
            "border border-border-strong bg-surface-3 px-2.5 py-1.5 text-[12px] font-medium " +
            "text-foreground shadow-[0_8px_24px_-8px_rgba(0,0,0,0.7)] transition-opacity duration-100",
          SIDE_CLS[side],
          open ? "opacity-100" : "opacity-0",
          className,
        )}
      >
        {content ?? label}
      </span>
    </span>
  );
}
