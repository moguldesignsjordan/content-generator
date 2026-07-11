"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { UserRole } from "@/lib/db/types";
import { Sidebar } from "./sidebar";
import { TabBar } from "./tab-bar";
import { ThemeToggle } from "./theme-toggle";

/**
 * Responsive native shell: mobile gets a sticky top bar + bottom tab bar;
 * desktop expands to a left sidebar + wider centered column. Same route tree,
 * responsive classes, not a phone frame.
 */
export function AppShell({
  userEmail,
  role,
  children,
}: {
  userEmail: string | null;
  role: UserRole;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const initials = (userEmail?.[0] ?? "M").toUpperCase();

  return (
    <div className="md:flex md:min-h-dvh">
      <Sidebar pathname={pathname} userEmail={userEmail} role={role} />

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header
          className={cn(
            "sticky top-0 z-40 flex min-h-14 items-center justify-between border-b border-transparent bg-background/85 backdrop-blur-xl transition-colors safe-header-pt safe-header-px md:hidden",
            scrolled && "border-border",
          )}
        >
          <Link href="/" aria-label="Mogul home">
            <Logo height={26} />
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Link
              href="/settings"
              aria-label="Account"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-2 text-[12px] font-semibold text-foreground"
            >
              {initials}
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-tabbar pt-4 md:max-w-4xl md:px-8 md:pb-16 md:pt-9">
          {children}
        </main>
      </div>

      <TabBar pathname={pathname} role={role} className="md:hidden" />
    </div>
  );
}
