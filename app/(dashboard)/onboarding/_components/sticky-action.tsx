import type { ReactNode } from "react";

/** The step's main action: pinned above the mobile tab bar, in flow on
 * desktop. Same floating bar as the media bulk actions. */
export function StickyAction({ hint, children }: { hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(88px+var(--sab))] z-20 mt-6 md:bottom-6">
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border-strong bg-surface/90 p-2.5 pl-4 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.55)] backdrop-blur-xl">
        <p className="min-w-0 text-[13px] leading-snug text-muted">{hint}</p>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
    </div>
  );
}
