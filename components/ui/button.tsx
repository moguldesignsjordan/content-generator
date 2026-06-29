import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

export type ButtonVariant =
  | "gradient"
  | "solid"
  | "outline"
  | "ghost"
  | "subtle";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium " +
  "whitespace-nowrap select-none transition-[transform,background-color,color,border-color,opacity] " +
  "duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 " +
  "focus-visible:outline-none";

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-[13px]",
  md: "h-11 px-6 text-[15px]",
  lg: "h-12 px-7 text-[15px]",
};

const VARIANTS: Record<ButtonVariant, string> = {
  // The single primary action per view. Ink text reads at ≥4.2:1 across every
  // stop of the spectrum (amber → magenta → violet → cyan), so contrast holds.
  gradient: "bg-spectrum text-ink font-semibold shadow-[0_8px_30px_-12px_rgba(255,61,140,0.6)]",
  solid: "bg-accent text-white font-semibold hover:bg-accent-press",
  outline:
    "border border-border-strong bg-transparent text-foreground hover:bg-surface-2",
  ghost: "bg-transparent text-foreground hover:bg-surface-2",
  subtle:
    "border border-border bg-surface-2 text-foreground hover:bg-surface-3",
};

export function buttonClasses(
  opts: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {},
): string {
  const { variant = "solid", size = "md", className } = opts;
  return cn(BASE, SIZES[size], VARIANTS[variant], className);
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = "solid",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={buttonClasses({ variant, size, className })}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner size={size === "sm" ? 14 : 16} />}
      {children}
    </button>
  );
}

export interface LinkButtonProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function LinkButton({
  href,
  variant = "solid",
  size = "md",
  className,
  children,
  ...props
}: LinkButtonProps) {
  return (
    <Link
      href={href}
      className={buttonClasses({ variant, size, className })}
      {...props}
    >
      {children}
    </Link>
  );
}
