"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ClusterWithTopics,
  FunnelStage,
  Topic,
  TopicFormData,
} from "@/lib/db/types";
import { StatusBadge, FunnelBadge, DraftLink } from "./topic-badges";

const EMPTY_FORM: TopicFormData = {
  title: "",
  target_keyword: "",
  intent: "",
  funnel_stage: "",
  maps_to_product: "",
};

function topicToForm(topic: Topic): TopicFormData {
  return {
    title: topic.title,
    target_keyword: topic.target_keyword ?? "",
    intent: topic.intent ?? "",
    funnel_stage: topic.funnel_stage ?? "",
    maps_to_product: topic.maps_to_product ?? "",
  };
}

interface ClusterCardProps {
  cluster: ClusterWithTopics;
  latestDraftByTopic: Record<string, { id: string; state: string; version: number }>;
}

export function ClusterCard({ cluster, latestDraftByTopic }: ClusterCardProps) {
  const router = useRouter();
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState<TopicFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpdateTopic(topicId: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/topics/${topicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: formData }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? "Failed to save.");
      }
      setEditingTopicId(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateTopic() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clusterId: cluster.id, data: formData }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? "Failed to create.");
      }
      setShowAddForm(false);
      setFormData(EMPTY_FORM);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTopic(topicId: string) {
    if (!confirm("Delete this topic? This cannot be undone.")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/topics/${topicId}`, { method: "DELETE" });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? "Failed to delete.");
      }
      setEditingTopicId(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface">
      {/* Cluster header */}
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-muted">Hub</p>
        <p className="font-medium">{cluster.hub_title}</p>
        {cluster.hub_keyword && (
          <p className="mt-0.5 text-xs text-muted">
            target: <code>{cluster.hub_keyword}</code>
          </p>
        )}
      </div>

      <ul>
        {cluster.topics.map((topic) => (
          <li key={topic.id} className="border-b border-border last:border-b-0">
            {/* Collapsed row */}
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm">{topic.title}</p>
                {topic.target_keyword && (
                  <p className="mt-0.5 truncate text-xs text-muted">
                    <code>{topic.target_keyword}</code>
                    {topic.intent ? ` · ${topic.intent}` : ""}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {topic.funnel_stage && (
                  <FunnelBadge stage={topic.funnel_stage} />
                )}
                <StatusBadge status={topic.status} />
                {latestDraftByTopic[topic.id] && (
                  <DraftLink draft={latestDraftByTopic[topic.id]} />
                )}
                <button
                  onClick={() => {
                    if (editingTopicId === topic.id) {
                      setEditingTopicId(null);
                    } else {
                      setFormData(topicToForm(topic));
                      setEditingTopicId(topic.id);
                      setShowAddForm(false);
                      setError(null);
                    }
                  }}
                  className="text-xs text-muted transition hover:text-foreground"
                >
                  {editingTopicId === topic.id ? "Cancel" : "Edit"}
                </button>
              </div>
            </div>

            {/* Inline edit panel */}
            {editingTopicId === topic.id && (
              <div className="border-t border-border bg-background/50 px-4 py-4">
                <TopicFields
                  formData={formData}
                  onChange={setFormData}
                  saving={saving}
                />
                {error && (
                  <p className="mt-2 text-xs text-red-400">{error}</p>
                )}
                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={() => handleUpdateTopic(topic.id)}
                    disabled={saving || !formData.title.trim()}
                    className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => setEditingTopicId(null)}
                    disabled={saving}
                    className="rounded-md border border-border px-3 py-1.5 text-xs text-muted transition hover:text-foreground disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  {topic.status === "idea" && (
                    <button
                      onClick={() => handleDeleteTopic(topic.id)}
                      disabled={saving}
                      className="ml-auto rounded-md px-3 py-1.5 text-xs text-red-400 transition hover:text-red-300 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}

        {cluster.topics.length === 0 && !showAddForm && (
          <li className="px-4 py-3 text-sm text-muted">No spoke topics yet.</li>
        )}

        {/* Inline add form */}
        {showAddForm && (
          <li className="border-b border-border bg-background/50 px-4 py-4 last:border-b-0">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
              New topic
            </p>
            <TopicFields
              formData={formData}
              onChange={setFormData}
              saving={saving}
            />
            {error && (
              <p className="mt-2 text-xs text-red-400">{error}</p>
            )}
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={handleCreateTopic}
                disabled={saving || !formData.title.trim()}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Creating…" : "Add topic"}
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setFormData(EMPTY_FORM);
                  setError(null);
                }}
                disabled={saving}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted transition hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </li>
        )}
      </ul>

      {/* Footer */}
      {!showAddForm && (
        <div className="border-t border-border px-4 py-2">
          <button
            onClick={() => {
              setFormData(EMPTY_FORM);
              setShowAddForm(true);
              setEditingTopicId(null);
              setError(null);
            }}
            className="text-xs text-accent transition hover:opacity-80"
          >
            + Add topic
          </button>
        </div>
      )}
    </div>
  );
}

function TopicFields({
  formData,
  onChange,
  saving,
}: {
  formData: TopicFormData;
  onChange: (data: TopicFormData) => void;
  saving: boolean;
}) {
  function set(field: keyof TopicFormData, value: string) {
    onChange({ ...formData, [field]: value });
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="text-xs uppercase tracking-wide text-muted">
          Title <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={formData.title}
          onChange={(e) => set("title", e.target.value)}
          disabled={saving}
          placeholder="e.g. How to write a cold email that gets replies"
          className={inputCls}
        />
      </div>

      <div>
        <label className="text-xs uppercase tracking-wide text-muted">
          Target keyword
        </label>
        <input
          type="text"
          value={formData.target_keyword}
          onChange={(e) => set("target_keyword", e.target.value)}
          disabled={saving}
          placeholder="e.g. cold email tips"
          className={inputCls}
        />
      </div>

      <div>
        <label className="text-xs uppercase tracking-wide text-muted">Intent</label>
        <input
          type="text"
          value={formData.intent}
          onChange={(e) => set("intent", e.target.value)}
          disabled={saving}
          placeholder="e.g. informational"
          className={inputCls}
        />
      </div>

      <div>
        <label className="text-xs uppercase tracking-wide text-muted">
          Funnel stage
        </label>
        <select
          value={formData.funnel_stage}
          onChange={(e) => set("funnel_stage", e.target.value as FunnelStage | "")}
          disabled={saving}
          className={inputCls}
        >
          <option value="">— inherit from pillar —</option>
          <option value="awareness">Awareness</option>
          <option value="consideration">Consideration</option>
          <option value="decision">Decision</option>
          <option value="brand">Brand</option>
        </select>
      </div>

      <div>
        <label className="text-xs uppercase tracking-wide text-muted">
          Maps to product
        </label>
        <input
          type="text"
          value={formData.maps_to_product}
          onChange={(e) => set("maps_to_product", e.target.value)}
          disabled={saving}
          placeholder="e.g. brand-audit"
          className={inputCls}
        />
      </div>
    </div>
  );
}

const inputCls =
  "mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-50";
