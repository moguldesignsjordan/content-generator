"use client";

import { useState } from "react";
import Link from "next/link";
import { Sheet } from "@/components/ui/sheet";
import { MoreGridIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import type { UserRole } from "@/lib/db/types";
import { NAV, NAV_GROUP_LABEL, type NavGroup, type NavItem } from "./nav";

/**
 * Fixed bottom tab bar (mobile only). Native iOS feel + safe-area padding.
 * The primary action (Create) rides in the middle as a raised button, the
 * other `core` items split around it, and a "More" tab closes the row;
 * everything else lives in the More sheet, grouped like the desktop sidebar.
 */
export function TabBar({
  pathname,
  role,
  reviewCount,
  className,
}: {
  pathname: string;
  role: UserRole;
  reviewCount: number;
  className?: string;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const items = NAV.filter((item) => !item.adminOnly || role === "admin");
  const primary = items.find((item) => item.primary);
  const core = items.filter((item) => item.core && !item.primary);
  // "More" joins the right side, so the left takes the larger half to keep
  // the raised button dead center.
  const left = core.slice(0, Math.ceil((core.length + 1) / 2));
  const right = core.slice(left.length);
  const overflow = items.filter((item) => !item.core);
  const overflowActive = overflow.some((item) => item.match(pathname));

  const groups = (["more", "account", "admin"] as NavGroup[])
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
          {left.map((item) => (
            <TabLink
              key={item.href}
              item={item}
              pathname={pathname}
              count={item.href === "/review" ? reviewCount : 0}
            />
          ))}
          {primary && <CreateTab item={primary} pathname={pathname} />}
          {right.map((item) => (
            <TabLink
              key={item.href}
              item={item}
              pathname={pathname}
              count={item.href === "/review" ? reviewCount : 0}
            />
          ))}
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

/** One tab: icon over label, magenta with a top tick when current, and a
 *  count badge when something is waiting there. */
function TabLink({ item, pathname, count }: { item: NavItem; pathname: string; count: number }) {
  const active = item.match(pathname);
  const { href, label, Icon } = item;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors",
        active ? "text-accent" : "text-muted hover:text-foreground",
      )}
    >
      {active && <span className="absolute top-0 h-[2.5px] w-6 rounded-full bg-accent" />}
      <span className="relative">
        <Icon size={20} />
        {count > 0 && (
          <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none tabular-nums text-white ring-2 ring-background">
            {count > 9 ? "9+" : count}
            <span className="sr-only"> waiting</span>
          </span>
        )}
      </span>
      <span className="whitespace-nowrap text-[10px] font-medium tracking-tight">{label}</span>
    </Link>
  );
}

/** The primary action as a raised button in the middle of the bar, where a
 *  thumb always finds it. Solid Hot Magenta: the chrome never wears the
 *  spectrum (one gradient per view stays on the page). */
function CreateTab({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.match(pathname);
  const { href, label, Icon } = item;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="flex flex-1 flex-col items-center gap-0.5 pb-2"
    >
      <span
        className={cn(
          "-mt-5 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-accent text-white ring-4 ring-background transition-transform active:scale-95",
          active
            ? "shadow-[0_10px_28px_-8px_rgba(255,61,140,0.75)]"
            : "shadow-[0_8px_22px_-10px_rgba(255,61,140,0.6)]",
        )}
      >
        <Icon size={24} />
      </span>
      <span
        className={cn(
          "whitespace-nowrap text-[10px] font-medium tracking-tight",
          active ? "text-accent" : "text-muted",
        )}
      >
        {label}
      </span>
    </Link>
  );
}
