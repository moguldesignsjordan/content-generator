import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/** A grouped list container: a Carbon surface with hairline-divided rows. */
export function ListGroup({
  label,
  description,
  className,
  children,
  footer,
}: {
  label?: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
  footer?: string;
}) {
  return (
    <div className={cn("mb-7", className)}>
      {label && (
        <div className="mb-2 px-1">
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
            {label}
          </p>
          {description && (
            <p className="mt-0.5 text-[13px] text-muted-2">{description}</p>
          )}
        </div>
      )}
      <div className="divide-y divide-border overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface">
        {children}
      </div>
      {footer && <p className="mt-2 px-1 text-xs text-muted-2">{footer}</p>}
    </div>
  );
}

export interface ListRowProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  chevron?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/** A grouped list row. Renders as a link, button, or plain row. */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  href,
  onClick,
  chevron,
  className,
  children,
}: ListRowProps) {
  const showChevron = chevron ?? Boolean(href || onClick);
  const inner = (
    <>
      {leading && <div className="flex shrink-0 items-center">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium text-foreground">
          {title}
        </div>
        {subtitle && (
          <div className="mt-0.5 truncate text-[13px] text-muted">{subtitle}</div>
        )}
        {children}
      </div>
      {trailing && <div className="flex shrink-0 items-center">{trailing}</div>}
      {showChevron && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className="shrink-0 text-muted-2"
          aria-hidden
        >
          <path
            d="M6 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </>
  );

  const classes = cn(
    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors " +
      "min-h-[52px] focus-visible:outline-none",
    (href || onClick) && "hover:bg-surface-2 active:bg-surface-3",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {inner}
      </button>
    );
  }
  return <div className={classes}>{inner}</div>;
}
