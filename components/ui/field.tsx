import * as React from "react";
import { cn } from "@/lib/cn";

const CONTROL =
  "w-full rounded-[var(--radius-md)] border border-border bg-surface-2 " +
  "px-3.5 text-[15px] text-foreground placeholder:text-muted transition " +
  "focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none " +
  "disabled:opacity-50";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input ref={ref} className={cn(CONTROL, "h-11", className)} {...props} />
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(CONTROL, "py-2.5 leading-relaxed resize-y", className)}
      {...props}
    />
  );
});

export function Label({
  className,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-[13px] font-medium text-foreground/90", className)}
      {...props}
    >
      {children}
    </label>
  );
}

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

/** Label + control + hint/error wrapper for form rows. */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn("block", className)}>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
