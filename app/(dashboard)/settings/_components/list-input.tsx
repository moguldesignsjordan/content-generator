"use client";

import { useRef, useState } from "react";
import { Button, Input, Label, Textarea } from "@/components/ui";

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
      {label && <Label>{label}</Label>}
      {hint && <p className="mb-2 text-xs text-muted">{hint}</p>}

      <ul className="space-y-2">
        {values.map((v, i) => (
          <li key={i} className="flex items-start gap-2">
            {multiline ? (
              <Textarea
                rows={3}
                value={v}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = e.target.value;
                  onChange(next);
                }}
                className="flex-1"
              />
            ) : (
              <Input
                value={v}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = e.target.value;
                  onChange(next);
                }}
                className="flex-1"
              />
            )}
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label="Remove"
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-danger"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex items-start gap-2">
        {multiline ? (
          <Textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1"
          />
        ) : (
          <Input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1"
          />
        )}
        <Button
          type="button"
          variant="subtle"
          size="sm"
          onClick={add}
          disabled={!draft.trim()}
          className="mt-1"
        >
          Add
        </Button>
      </div>
    </div>
  );
}
