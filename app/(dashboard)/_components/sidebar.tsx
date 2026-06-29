"use client";

import Link from "next/link";
import { Logo } from "@/components/ui";
import { LogoutIcon } from "@/components/ui/icons";
import { signOut } from "@/lib/supabase/actions";
import { cn } from "@/lib/cn";
import { NAV } from "./nav";

/** Desktop left sidebar: logo, nav, account + sign-out. */
export function Sidebar({
  pathname,
  userEmail,
}: {
  pathname: string;
  userEmail: string | null;
}) {
  const initials = (userEmail?.[0] ?? "M").toUpperCase();

  return (
    <aside className="sticky top-0 hidden h-dvh w-[244px] shrink-0 flex-col border-r border-border bg-surface/30 md:flex">
      <div className="flex h-16 items-center px-5">
        <Link href="/" aria-label="Mogul home">
          <Logo height={28} />
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-3">
        {NAV.map(({ href, label, Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
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
        })}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] px-2 py-1.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-[13px] font-semibold text-foreground">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] text-foreground">
              {userEmail ?? "Signed in"}
            </p>
            <p className="text-[11px] text-muted-2">Mogul account</p>
          </div>
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
