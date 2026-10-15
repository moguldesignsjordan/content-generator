import * as React from "react";
import Image, { type StaticImageData } from "next/image";
import { cn } from "@/lib/cn";

/**
 * "Nothing here yet", made friendly: a piece of glass art, a short title, one
 * line on what to do about it, and the next step as an action.
 */
export function EmptyState({
  art,
  title,
  children,
  action,
  className,
}: {
  art: StaticImageData;
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-[var(--radius-card)] border border-border bg-surface px-6 pb-8 pt-7 text-center",
        className,
      )}
    >
      <div className="art-frame h-32 w-32 overflow-hidden rounded-[28px] sm:h-36 sm:w-36">
        <Image
          src={art}
          alt=""
          sizes="144px"
          placeholder="blur"
          className="art-float h-full w-full scale-[1.2] object-cover"
        />
      </div>
      <h2 className="mt-5 font-display text-[20px] font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {children && (
        <p className="mx-auto mt-1.5 max-w-sm text-[14px] leading-relaxed text-muted">
          {children}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
