"use client";

import Link from "next/link";
import { Logo } from "@/components/ui";
import { LogoutIcon } from "@/components/ui/icons";
import { signOut } from "@/lib/supabase/actions";
import { cn } from "@/lib/cn";
import type { UserRole } from "@/lib/db/types";
import { NAV, NAV_GROUP_LABEL, type NavGroup, type NavItem } from "./nav";
import { ThemeToggle } from "./theme-toggle";

/**
 * Desktop left sidebar. Three zones, top to bottom:
 *   1. Logo + the pinned primary action (Create) — always reachable.
 *   2. The work destinations (Content, Media) — the only things that scroll.
 *   3. A bottom utility cluster (Account, Admin) + the account pill.
 * Account/admin live at the bottom, not in the main list, so the primary nav
 * surface stays short and the eye always lands on Create first.
 */
export function Sidebar({
  pathname,
  userEmail,
  role,
}: {
  pathname: string;
  userEmail: string | null;
  role: UserRole;
}) {
  const initials = (userEmail?.[0] ?? "M").toUpperCase();
  const items = NAV.filter((item) => !item.adminOnly || role === "admin");

  const primary = items.find((item) => item.primary);
  const top = items.filter((item) => !item.group && !item.primary);
  const mainGroups = groupBy(items, ["content", "media"]);
  const accountItems = items.filter((item) => item.group === "account");
  const adminItems = items.filter((item) => item.group === "admin");

  return (
    <aside className="sticky top-0 hidden h-dvh w-[244px] shrink-0 flex-col border-r border-border bg-surface/30 md:flex">
      <div className="flex h-16 items-center px-5">
        <Link href="/" aria-label="Mogul home">
          <Logo height={28} />
        </Link>
      </div>

      {primary && (
        <div className="px-3 pb-1">
          <PrimaryLink item={primary} pathname={pathname} />
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-3 py-2 no-scrollbar">
        <div className="space-y-0.5">
          {top.map((item) => (
            <NavRow key={item.href} item={item} pathname={pathname} />
          ))}
        </div>
        {mainGroups.map(({ group, items: groupItems }) => (
          <div key={group} className="mt-5 space-y-0.5">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
              {NAV_GROUP_LABEL[group]}
            </p>
            {groupItems.map((item) => (
              <NavRow key={item.href} item={item} pathname={pathname} />
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        {accountItems.length > 0 && (
          <div className="space-y-0.5">
            {accountItems.map((item) => (
              <NavRow key={item.href} item={item} pathname={pathname} />
            ))}
          </div>
        )}
        {adminItems.length > 0 && (
          <div className="space-y-0.5">
            {accountItems.length > 0 && (
              <div className="mx-3 my-1 h-px bg-border" />
            )}
            {adminItems.map((item) => (
              <NavRow key={item.href} item={item} pathname={pathname} />
            ))}
          </div>
        )}

        <div className="mt-2 flex items-center gap-1 rounded-[var(--radius-md)] px-1.5 py-1.5">
          <Link
            href="/settings"
            aria-label="Account settings"
            title="Account settings"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-[13px] font-semibold text-foreground transition-colors hover:border-border-strong"
          >
            {initials}
          </Link>
          <p className="min-w-0 flex-1 truncate px-1 text-[13px] text-foreground">
            {userEmail ?? "Signed in"}
          </p>
          <ThemeToggle />
          <form action={signOut}>
            <button
              type="submit"
              title="Sign out"
              aria-label="Sign out"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <LogoutIcon size={18} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

/** Standard nav row: icon + label, with a magenta tick + filled surface when current. */
function NavRow({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.match(pathname);
  const { href, label, Icon } = item;
  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-3 rounded-[var(--radius-md)] px-3 h-11 text-[15px] font-medium transition-colors",
        active
          ? "bg-surface-2 text-foreground"
          : "text-muted hover:bg-surface-2/50 hover:text-foreground",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-accent" />
      )}
      <Icon size={20} className={active ? "text-accent" : ""} />
      {label}
    </Link>
  );
}

/** The app's one primary action — pinned, elevated, magenta-tinted so it reads
 *  as a CTA without wearing the spectrum gradient (one gradient per view stays
 *  on the page, not the chrome). */
function PrimaryLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.match(pathname);
  const { href, label, Icon } = item;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-11 items-center gap-2.5 rounded-[var(--radius-md)] border px-3.5 text-[15px] font-semibold text-foreground transition-colors",
        active
          ? "border-accent/45 bg-accent/20"
          : "border-accent/25 bg-accent/10 hover:bg-accent/[0.16]",
      )}
    >
      <Icon size={20} className="text-accent" />
      {label}
    </Link>
  );
}

function groupBy(items: NavItem[], groups: NavGroup[]) {
  return groups
    .map((group) => ({
      group,
      items: items.filter((item) => item.group === group),
    }))
    .filter((section) => section.items.length > 0);
}
