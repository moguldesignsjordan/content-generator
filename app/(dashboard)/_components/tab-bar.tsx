"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { NAV } from "./nav";

/** Fixed bottom tab bar (mobile only). Native iOS feel + safe-area padding. */
export function TabBar({
  pathname,
  className,
}: {
  pathname: string;
  className?: string;
}) {
  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/85 backdrop-blur-xl",
        className,
      )}
      style={{ paddingBottom: "var(--sab)" }}
    >
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2">
        {NAV.map(({ href, label, Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors",
                active ? "text-accent" : "text-muted hover:text-foreground",
              )}
            >
              {active && (
                <span className="absolute top-0 h-[2.5px] w-8 rounded-full bg-accent" />
              )}
              <Icon size={22} />
              <span className="text-[10.5px] font-medium tracking-tight">
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
