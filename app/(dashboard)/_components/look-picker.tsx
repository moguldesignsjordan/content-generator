"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { DesignLook } from "@/lib/db/types";
import { LookBuilder } from "./look-builder";

// Picks the design look flyers follow. null = Our style (the default look,
// else the flyers the brand approved or liked); "none" = No reference
// (the AI picks a fresh style per option); "images" = the chat's style
// images (the owner's own designs or the competitor ads they ticked);
// otherwise a saved look's id.

export function LookPicker({
  value,
  onChange,
  disabled,
  styleImages,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  /** Offered as their own tile when the chat has any. */
  styleImages?: { urls: string[]; from: "upload" | "competitor" } | null;
}) {
  const toast = useToast();
  const [looks, setLooks] = useState<DesignLook[] | null>(null);
  const [house, setHouse] = useState<string[]>([]);
  // "default": opened to add examples to Our style, so saving makes it the default.
  const [building, setBuilding] = useState<"new" | "default" | null>(null);

  useEffect(() => {
    fetch("/api/looks")
      .then((r) => r.json())
      .then((d: { looks?: DesignLook[]; house?: string[] }) => {
        setLooks(d.looks ?? []);
        setHouse(d.house ?? []);
      })
      .catch(() => setLooks([]));
  }, []);

  const defaultLook = looks?.find((l) => l.is_default) ?? null;
  const ourExamples = defaultLook ? defaultLook.examples.map((e) => e.url) : house;
  const savedLooks = looks?.filter((l) => !l.is_default) ?? [];
  // A look id that points at the default is the same thing as Our style.
  const activeId = value === null || value === defaultLook?.id ? null : value;
  const active = activeId === null ? defaultLook : (looks?.find((l) => l.id === activeId) ?? null);

  const imagesHint =
    styleImages?.from === "competitor"
      ? "Follows their ads' layout and type, in your brand colors with your logo. Never their words, products, or photos."
      : "Follows your designs, in your brand colors.";
  const hint =
    activeId === "none"
      ? "No reference: the AI picks a fresh style for each option, in your brand colors."
      : activeId === "images"
        ? imagesHint
        : activeId !== null
          ? (active?.profile?.summary ?? "Flyers follow these examples, in your brand colors.")
          : defaultLook
            ? (defaultLook.profile?.summary ?? `Follows your "${defaultLook.name}" look.`)
            : house.length
              ? "Follows flyers you approved or liked. Add examples to set it exactly."
              : "Our style needs examples. Add 2 or 3 of your own designs, or pick No reference.";

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
        {styleImages && styleImages.urls.length > 0 && (
          <button
            type="button"
            aria-pressed={activeId === "images"}
            disabled={disabled}
            onClick={() => onChange("images")}
            className={cn(
              "flex h-[72px] w-40 flex-col overflow-hidden rounded-[var(--radius-md)] border text-left transition-colors",
              activeId === "images" ? "border-accent" : "border-border hover:border-border-strong",
            )}
          >
            <span className="flex h-11 w-full">
              {styleImages.urls.slice(0, 3).map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={url} src={url} alt="" className="h-full min-w-0 flex-1 object-cover" loading="lazy" />
              ))}
            </span>
            <span className="truncate px-2 py-1 text-[12px] font-medium text-foreground">
              {styleImages.from === "competitor" ? "Their ads" : "Your designs"}
            </span>
          </button>
        )}
        <button
          type="button"
          aria-pressed={activeId === null}
          disabled={disabled}
          onClick={() => onChange(null)}
          className={cn(
            "flex h-[72px] w-40 flex-col overflow-hidden rounded-[var(--radius-md)] border text-left transition-colors",
            activeId === null ? "border-accent" : "border-border hover:border-border-strong",
          )}
        >
          {ourExamples.length ? (
            <span className="flex h-11 w-full">
              {ourExamples.slice(0, 3).map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={url} src={url} alt="" className="h-full min-w-0 flex-1 object-cover" loading="lazy" />
              ))}
            </span>
          ) : (
            <span className="flex h-11 w-full items-center justify-center bg-surface-2 text-[11px] text-muted">
              No examples yet
            </span>
          )}
          <span className="truncate px-2 py-1 text-[12px] font-medium text-foreground">Our style</span>
        </button>
        <button
          type="button"
          aria-pressed={activeId === "none"}
          disabled={disabled}
          onClick={() => onChange("none")}
          className={cn(
            "flex h-[72px] w-28 items-center justify-center rounded-[var(--radius-md)] border px-2 text-center text-[12px] font-medium transition-colors",
            activeId === "none" ? "border-accent bg-accent/[0.08] text-foreground" : "border-border text-muted hover:text-foreground",
          )}
        >
          No reference
        </button>
        {savedLooks.map((look) => (
          <button
            key={look.id}
            type="button"
            aria-pressed={activeId === look.id}
            disabled={disabled}
            onClick={() => onChange(look.id)}
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
            <span className="truncate px-2 py-1 text-[12px] font-medium text-foreground">{look.name}</span>
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setBuilding("new")}
          className="flex h-[72px] w-28 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-border-strong text-[12px] font-medium text-accent transition-colors hover:bg-accent/[0.06]"
        >
          + New look
        </button>
      </div>

      <p className="text-[12px] text-muted">{hint}</p>
      {!disabled && (
        <div className="flex gap-4 text-[12px]">
          {activeId === null && !defaultLook && (
            <button type="button" className="font-medium text-accent hover:text-accent-press" onClick={() => setBuilding("default")}>
              Add examples
            </button>
          )}
          {active && (
            <>
              <button type="button" className="font-medium text-accent hover:text-accent-press" onClick={() => void setDefault(active, !active.is_default)}>
                {active.is_default ? "Stop using as our style" : "Make this our style"}
              </button>
              <button type="button" className="text-muted hover:text-danger" onClick={() => void remove(active)}>
                Delete look
              </button>
            </>
          )}
        </div>
      )}

      <LookBuilder
        open={building !== null}
        startAsDefault={building === "default"}
        onClose={() => setBuilding(null)}
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
