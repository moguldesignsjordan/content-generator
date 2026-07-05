"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export type CheckboxSize = "sm" | "md";
export type CheckboxTone = "accent" | "neutral";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "type"> {
  size?: CheckboxSize;
  tone?: CheckboxTone;
  indeterminate?: boolean;
}

const BOX_SIZES: Record<CheckboxSize, string> = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
};

const TONE_CLS: Record<CheckboxTone, string> = {
  accent:
    "peer-checked:border-accent peer-checked:bg-accent peer-indeterminate:border-accent peer-indeterminate:bg-accent",
  neutral:
    "peer-checked:border-foreground peer-checked:bg-foreground peer-indeterminate:border-foreground peer-indeterminate:bg-foreground",
};

/** Custom-styled checkbox over a real (visually hidden) input, so native a11y/keyboard behavior is free. */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox(
    { size = "md", tone = "accent", indeterminate = false, className, ...props },
    forwardedRef,
  ) {
    const innerRef = React.useRef<HTMLInputElement>(null);

    React.useImperativeHandle(
      forwardedRef,
      () => innerRef.current as HTMLInputElement,
    );

    React.useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = indeterminate;
    }, [indeterminate]);

    return (
      <span
        className={cn("relative inline-flex shrink-0", BOX_SIZES[size], className)}
      >
        <input
          ref={innerRef}
          type="checkbox"
          aria-checked={indeterminate ? "mixed" : props.checked}
          className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
          {...props}
        />
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-0 rounded-[6px] border border-border-strong bg-surface-2 transition-colors",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-accent/25",
            TONE_CLS[tone],
          )}
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          className="pointer-events-none absolute inset-0 h-full w-full stroke-ink stroke-[2.5] opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-0"
        >
          <path d="M4 8.3l2.6 2.6L12 5.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 h-[2px] w-2/3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink opacity-0 peer-indeterminate:opacity-100"
        />
      </span>
    );
  },
);
