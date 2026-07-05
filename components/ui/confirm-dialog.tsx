"use client";

import * as React from "react";
import { Button } from "./button";
import { Sheet } from "./sheet";

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  tone?: "danger" | "default";
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
}

/** Sheet-based replacement for window.confirm, with a danger tone for destructive actions. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = "Are you sure?",
  description,
  tone = "default",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="md"
      footer={
        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "solid" : "gradient"}
            className={tone === "danger" ? "bg-danger hover:bg-danger/90" : undefined}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {null}
    </Sheet>
  );
}
