"use client";

import { useState } from "react";
import Link from "next/link";
import { Sheet } from "@/components/ui/sheet";
import { MoreGridIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import type { UserRole } from "@/lib/db/types";
import { NAV, NAV_GROUP_LABEL, type NavGroup } from "./nav";

/**
 * Fixed bottom tab bar (mobile only). Native iOS feel + safe-area padding.
 * Shows only `core` nav items plus a "More" tab; everything else lives in
 * the More sheet, grouped the same way as the desktop sidebar.
 */
export function TabBar({
  pathname,
  role,
  className,
}: {
  pathname: string;
  role: UserRole;
  className?: string;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const items = NAV.filter((item) => !item.adminOnly || role === "admin");
  const core = items.filter((item) => item.core);
  const overflow = items.filter((item) => !item.core);
  const overflowActive = overflow.some((item) => item.match(pathname));

  const groups = (["content", "media", "account", "admin"] as NavGroup[])
    .map((group) => ({
      group,
      items: overflow.filter((item) => item.group === group),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <>
      <nav
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/85 backdrop-blur-xl",
          className,
        )}
        style={{ paddingBottom: "var(--sab)" }}
      >
        <div className="flex items-stretch justify-around px-1">
          {core.map(({ href, label, Icon, match }) => {
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
                <span className="whitespace-nowrap text-[10px] font-medium tracking-tight">
                  {label}
                </span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              "relative flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors",
              overflowActive
                ? "text-accent"
                : "text-muted hover:text-foreground",
            )}
          >
            {overflowActive && (
              <span className="absolute top-0 h-[2.5px] w-6 rounded-full bg-accent" />
            )}
            <MoreGridIcon size={20} />
            <span className="whitespace-nowrap text-[10px] font-medium tracking-tight">
              More
            </span>
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="space-y-5 pb-2">
          {groups.map(({ group, items: groupItems }) => (
            <div key={group}>
              <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                {NAV_GROUP_LABEL[group]}
              </p>
              <div className="space-y-1">
                {groupItems.map(({ href, label, Icon, match }) => {
                  const active = match(pathname);
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-[var(--radius-md)] px-3 h-11 text-[15px] font-medium transition-colors",
                        active
                          ? "bg-surface-2 text-foreground"
                          : "text-muted hover:bg-surface-2/50 hover:text-foreground",
                      )}
                    >
                      <Icon size={20} className={active ? "text-accent" : ""} />
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Sheet>
    </>
  );
}
