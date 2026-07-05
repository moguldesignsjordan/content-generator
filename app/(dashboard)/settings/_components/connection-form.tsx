"use client";

import { useState } from "react";
import { Button, Card, ConfirmDialog, Field, Input, useToast } from "@/components/ui";
import { ListInput } from "./list-input";
import type { ProviderField } from "@/lib/publishing/provider";
import type { ConnectionState } from "@/lib/publishing/connections";

// One shared form for every provider, driven by the provider's `fields` array
// (the single source of truth defined in lib/publishing/providers/*). Secrets
// are masked; their inputs start blank and carry a "leave blank to keep"
// placeholder when a value is already stored. Plain and list fields show
// their stored value and edit in place. After Save/Disconnect the form
// refetches the connection state so the banner and secret-saved indicators
// stay truthful without a full page reload.

export interface ConnectionInitial {
  state: ConnectionState;
  values: Record<string, string | string[]>;
  secretIsSet: Record<string, boolean>;
}

interface ConnectionFormProps {
  brandId: string;
  providerId: string;
  fields: ProviderField[];
  initial: ConnectionInitial;
}

export function ConnectionForm({
  brandId,
  providerId,
  fields,
  initial,
}: ConnectionFormProps) {
  const [values, setValues] = useState<Record<string, string | string[]>>(
    initial.values,
  );
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [state, setState] = useState<ConnectionState>(initial.state);
  const [secretIsSet, setSecretIsSet] = useState<Record<string, boolean>>(
    initial.secretIsSet,
  );
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const toast = useToast();

  async function refresh() {
    const res = await fetch(
      `/api/settings/connections?brandId=${encodeURIComponent(brandId)}`,
    );
    if (!res.ok) return;
    const data = (await res.json()) as {
      connections: Array<{
        id: string;
        state: ConnectionState;
        values: Record<string, string | string[]>;
        secretIsSet: Record<string, boolean>;
      }>;
    };
    const entry = data.connections.find((c) => c.id === providerId);
    if (!entry) return;
    setState(entry.state);
    setValues(entry.values);
    setSecretIsSet(entry.secretIsSet);
    setSecrets({});
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...values };
      for (const f of fields) {
        if (f.secret) payload[f.key] = secrets[f.key] ?? "";
      }
      const res = await fetch("/api/settings/connections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, providerId, fields: payload }),
      });
      if (!res.ok) throw new Error();
      await refresh();
      toast.success("Saved.");
    } catch {
      toast.error("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch(
        `/api/settings/connections?brandId=${encodeURIComponent(brandId)}&providerId=${encodeURIComponent(providerId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
      await refresh();
      toast.success("Disconnected.");
      setConfirmOpen(false);
    } catch {
      toast.error("Failed to disconnect.");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <Card className="space-y-5 p-5">
      <Banner state={state} />

      {fields.map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint}>
          {f.secret ? (
            <Input
              type="password"
              value={secrets[f.key] ?? ""}
              onChange={(e) =>
                setSecrets((s) => ({ ...s, [f.key]: e.target.value }))
              }
              placeholder={
                secretIsSet[f.key]
                  ? "•••• saved — leave blank to keep"
                  : (f.placeholder ?? "Paste your value")
              }
              autoComplete="off"
            />
          ) : f.list ? (
            <ListInput
              label=""
              values={(values[f.key] as string[]) ?? []}
              onChange={(v) =>
                setValues((vals) => ({ ...vals, [f.key]: v }))
              }
              placeholder={f.placeholder ?? "Add item…"}
            />
          ) : (
            <Input
              value={(values[f.key] as string) ?? ""}
              onChange={(e) =>
                setValues((vals) => ({ ...vals, [f.key]: e.target.value }))
              }
              placeholder={f.placeholder}
            />
          )}
        </Field>
      ))}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button variant="gradient" loading={saving} onClick={handleSave}>
          Save
        </Button>
        {state === "account" && (
          <Button
            variant="ghost"
            onClick={() => setConfirmOpen(true)}
            className="text-danger"
          >
            Disconnect
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDisconnect}
        loading={disconnecting}
        title="Disconnect this connection?"
        description="Your saved credentials for this provider will be removed. It falls back to its server env vars, if any are set."
        confirmLabel="Disconnect"
        tone="danger"
      />
    </Card>
  );
}

function Banner({ state }: { state: ConnectionState }) {
  if (state === "account") {
    return (
      <p className="rounded-[var(--radius-md)] bg-surface-2 px-3.5 py-2.5 text-[13px] text-foreground/90">
        Connected via your account.
      </p>
    );
  }
  if (state === "env") {
    return (
      <p className="rounded-[var(--radius-md)] bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted">
        Using server default (.env). Connect your own account to override it.
      </p>
    );
  }
  return (
    <p className="rounded-[var(--radius-md)] bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted">
      Not connected. Add your credentials below, or set the server env vars.
    </p>
  );
}
