"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { DesignLook } from "@/lib/db/types";
import { LookBuilder } from "./look-builder";

// Picks the design look flyers follow. null = automatic (the brand's default
// look when it has one, else the code-set layouts); "none" = the code-set
// layouts even when a default exists; otherwise a look id.

export function LookPicker({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const toast = useToast();
  const [looks, setLooks] = useState<DesignLook[] | null>(null);
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    fetch("/api/looks")
      .then((r) => r.json())
      .then((d: { looks?: DesignLook[] }) => setLooks(d.looks ?? []))
      .catch(() => setLooks([]));
  }, []);

  const defaultLook = looks?.find((l) => l.is_default) ?? null;
  const activeId = value === null ? (defaultLook?.id ?? "none") : value;
  const active = looks?.find((l) => l.id === activeId) ?? null;

  async function setDefault(look: DesignLook, isDefault: boolean) {
    const res = await fetch(`/api/looks/${look.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default: isDefault }),
    });
    if (!res.ok) return toast.error("Couldn't update the look.");
    // Only one default per brand: setting one clears the rest.
    setLooks(
      (cur) =>
        cur?.map((l) =>
          l.id === look.id
            ? { ...l, is_default: isDefault }
            : isDefault
              ? { ...l, is_default: false }
              : l,
        ) ?? null,
    );
  }

  async function remove(look: DesignLook) {
    const res = await fetch(`/api/looks/${look.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("Couldn't delete the look.");
    setLooks((cur) => cur?.filter((l) => l.id !== look.id) ?? null);
    if (value === look.id) onChange(null);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={activeId === "none"}
          disabled={disabled}
          onClick={() => onChange(defaultLook ? "none" : null)}
          className={cn(
            "flex h-[72px] w-28 items-center justify-center rounded-[var(--radius-md)] border px-2 text-center text-[12px] font-medium transition-colors",
            activeId === "none" ? "border-accent bg-accent/[0.08] text-foreground" : "border-border text-muted hover:text-foreground",
          )}
        >
          Our layouts
        </button>
        {looks?.map((look) => (
          <button
            key={look.id}
            type="button"
            aria-pressed={activeId === look.id}
            disabled={disabled}
            onClick={() => onChange(look.is_default ? null : look.id)}
            className={cn(
              "flex h-[72px] w-40 flex-col overflow-hidden rounded-[var(--radius-md)] border text-left transition-colors",
              activeId === look.id ? "border-accent" : "border-border hover:border-border-strong",
            )}
          >
            <span className="flex h-11 w-full">
              {look.examples.slice(0, 3).map((ex) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={ex.url} src={ex.url} alt="" className="h-full min-w-0 flex-1 object-cover" loading="lazy" />
              ))}
            </span>
            <span className="flex items-center gap-1.5 truncate px-2 py-1 text-[12px] font-medium text-foreground">
              <span className="truncate">{look.name}</span>
              {look.is_default && <span className="shrink-0 text-[10px] text-accent">Default</span>}
            </span>
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setBuilding(true)}
          className="flex h-[72px] w-28 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-border-strong text-[12px] font-medium text-accent transition-colors hover:bg-accent/[0.06]"
        >
          + New look
        </button>
      </div>

      <p className="text-[12px] text-muted">
        {active
          ? active.profile?.summary ?? "Flyers follow these examples, in your brand colors."
          : "Our own layouts, with your colors and logo. Add a look to match ads you like."}
      </p>
      {active && !disabled && (
        <div className="flex gap-4 text-[12px]">
          <button type="button" className="font-medium text-accent hover:text-accent-press" onClick={() => void setDefault(active, !active.is_default)}>
            {active.is_default ? "Stop using as default" : "Make default"}
          </button>
          <button type="button" className="text-muted hover:text-danger" onClick={() => void remove(active)}>
            Delete look
          </button>
        </div>
      )}

      <LookBuilder
        open={building}
        onClose={() => setBuilding(false)}
        onSaved={(look) => {
          setLooks((cur) => [
            look,
            ...(cur ?? []).map((l) => (look.is_default ? { ...l, is_default: false } : l)),
          ]);
          onChange(look.is_default ? null : look.id);
        }}
      />
    </div>
  );
}
