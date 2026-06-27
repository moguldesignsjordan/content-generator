"use client";

import { useRef, useState } from "react";

interface ListInputProps {
  label: string;
  hint?: string;
  values: string[];
  onChange: (values: string[]) => void;
  multiline?: boolean;
  placeholder?: string;
}

export function ListInput({
  label,
  hint,
  values,
  onChange,
  multiline = false,
  placeholder = "Add item…",
}: ListInputProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  function add() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...values, trimmed]);
    setDraft("");
    inputRef.current?.focus();
  }

  function remove(i: number) {
    onChange(values.filter((_, idx) => idx !== i));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      add();
    }
  }

  return (
    <div>
      <label className="text-xs uppercase tracking-wide text-muted">{label}</label>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}

      <ul className="mt-2 space-y-1.5">
        {values.map((v, i) => (
          <li key={i} className="flex items-start gap-2">
            {multiline ? (
              <textarea
                value={v}
                rows={3}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = e.target.value;
                  onChange(next);
                }}
                className="flex-1 rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none resize-y"
              />
            ) : (
              <input
                type="text"
                value={v}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = e.target.value;
                  onChange(next);
                }}
                className="flex-1 rounded border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
              />
            )}
            <button
              type="button"
              onClick={() => remove(i)}
              className="mt-1 text-muted hover:text-red-400 transition text-xs"
              aria-label="Remove"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex gap-2">
        {multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none resize-y"
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 rounded border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
          />
        )}
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="rounded border border-border px-3 py-1.5 text-xs text-muted transition hover:text-foreground disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}
