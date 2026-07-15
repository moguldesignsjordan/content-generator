"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export type ToastTone = "neutral" | "success" | "warning" | "danger" | "info";

export interface ToastAction {
  label: string;
  href: string;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

export interface ToastHandle {
  show: (
    message: string,
    opts?: { tone?: ToastTone; duration?: number; action?: ToastAction },
  ) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number, action?: ToastAction) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = React.createContext<ToastHandle | null>(null);

const TONE_CLS: Record<ToastTone, string> = {
  neutral: "border-border-strong bg-surface-3 text-foreground",
  success: "border-success/25 bg-success/15 text-success",
  warning: "border-warning/25 bg-warning/15 text-warning",
  danger: "border-danger/25 bg-danger/15 text-danger",
  info: "border-cyan/25 bg-cyan/15 text-cyan",
};

let idCounter = 0;

/** Mount once near the root (see app/layout.tsx). Renders queued toasts via portal. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = React.useCallback<ToastHandle["show"]>(
    (message, opts) => {
      const id = ++idCounter;
      // An actioned toast (e.g. "Buy credits") needs time to read and click;
      // don't auto-dismiss it out from under the user.
      const duration = opts?.duration ?? (opts?.action ? 8000 : 4000);
      const tone = opts?.tone ?? "neutral";
      setToasts((prev) => [...prev, { id, message, tone, action: opts?.action }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = React.useMemo<ToastHandle>(
    () => ({
      show,
      success: (message, duration) => show(message, { tone: "success", duration }),
      error: (message, duration, action) => show(message, { tone: "danger", duration, action }),
      warning: (message, duration) => show(message, { tone: "warning", duration }),
      info: (message, duration) => show(message, { tone: "info", duration }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted &&
        createPortal(
          <div
            className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] flex flex-col items-center gap-2 p-4 md:items-end"
            style={{ paddingBottom: "calc(var(--sab, 0px) + 1rem)" }}
          >
            {toasts.map((t) => (
              <div
                key={t.id}
                role="status"
                aria-live={t.tone === "danger" ? "assertive" : "polite"}
                className={cn(
                  "pointer-events-auto w-full max-w-sm rounded-[var(--radius-md)] border px-4 py-3 " +
                    "text-[14px] font-medium shadow-[0_12px_40px_-12px_rgba(0,0,0,0.7)]",
                  TONE_CLS[t.tone],
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span>{t.message}</span>
                  {t.action && (
                    <a
                      href={t.action.href}
                      className="shrink-0 rounded-[var(--radius-sm)] underline underline-offset-2 hover:no-underline"
                    >
                      {t.action.label}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastHandle {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
