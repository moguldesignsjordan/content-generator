"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import type { UserRole } from "@/lib/db/types";
import { NAV } from "./nav";

/** Fixed bottom tab bar (mobile only). Native iOS feel + safe-area padding. */
export function TabBar({
  pathname,
  role,
  className,
}: {
  pathname: string;
  role: UserRole;
  className?: string;
}) {
  const items = NAV.filter((item) => !item.adminOnly || role === "admin");

  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/85 backdrop-blur-xl",
        className,
      )}
      style={{ paddingBottom: "var(--sab)" }}
    >
      <div className="flex items-stretch justify-around px-1">
        {items.map(({ href, label, Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors",
                active ? "text-accent" : "text-muted hover:text-foreground",
              )}
            >
              {active && (
                <span className="absolute top-0 h-[2.5px] w-6 rounded-full bg-accent" />
              )}
              <Icon size={20} />
              <span className="whitespace-nowrap text-[9.5px] font-medium tracking-tight">
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
