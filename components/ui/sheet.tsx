"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * Slide-up sheet on mobile, centered modal on desktop. Portals to body so it
 * escapes any overflow/stacking context. Esc + backdrop close; body scroll
 * locked while open. Respects safe-area at the bottom on notched devices.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  size?: "md" | "lg" | "xl";
}) {
  const sizeClass =
    size === "xl"
      ? "md:max-w-2xl"
      : size === "lg"
        ? "md:max-w-xl"
        : "md:max-w-lg";
  const [render, setRender] = React.useState(open);
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setRender(true);
      const t = setTimeout(() => setShow(true), 12);
      return () => clearTimeout(t);
    }
    setShow(false);
    const t = setTimeout(() => setRender(false), 220);
    return () => clearTimeout(t);
  }, [open]);

  React.useEffect(() => {
    if (!render) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [render, onClose]);

  if (!render || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center md:items-center md:p-6">
      <div
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-black/65 backdrop-blur-[2px] transition-opacity duration-200",
          show ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 flex max-h-[90dvh] w-full flex-col overflow-hidden " +
            "rounded-t-[var(--radius-card)] border border-border bg-surface " +
            "shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.7)] transition-all duration-200 " +
            "md:rounded-[var(--radius-card)] md:shadow-2xl",
          sizeClass,
          show
            ? "translate-y-0 opacity-100"
            : "translate-y-8 opacity-0 md:translate-y-0 md:scale-[0.98]",
          className,
        )}
        style={{ paddingBottom: "var(--sab)" }}
      >
        {/* grabber (mobile) */}
        <div className="flex justify-center pt-2.5 md:hidden">
          <span className="h-1 w-9 rounded-full bg-foreground/15" />
        </div>

        {(title || description) && (
          <header className="px-5 pb-3 pt-3 md:pt-5">
            {title && (
              <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-1 text-[14px] text-muted">{description}</p>
            )}
          </header>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 momentum">
          {children}
        </div>

        {footer && (
          <footer className="border-t border-border bg-surface-2/60 p-4">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
