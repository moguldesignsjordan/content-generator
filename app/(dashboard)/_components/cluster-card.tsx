"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input } from "@/components/ui";
import type {
  ClusterWithTopics,
  FunnelStage,
  Topic,
  TopicFormData,
} from "@/lib/db/types";
import { StatusBadge, FunnelBadge, DraftLink } from "./topic-badges";
import { GenerateButton } from "./generate-button";

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

const SELECT_CLS =
  "mt-1 h-11 w-full rounded-[var(--radius-md)] border border-border bg-surface-2 px-3.5 text-[15px] text-foreground focus:border-accent focus:outline-none disabled:opacity-50";

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
    <Card className="overflow-hidden">
      {/* Cluster header */}
      <div className="border-b border-border px-4 py-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
          Hub
        </p>
        <p className="font-medium text-foreground">{cluster.hub_title}</p>
        {cluster.hub_keyword && (
          <p className="mt-0.5 text-[13px] text-muted">
            target: <code className="text-foreground/80">{cluster.hub_keyword}</code>
          </p>
        )}
      </div>

      <ul className="divide-y divide-border">
        {cluster.topics.map((topic) => (
          <li key={topic.id}>
            {/* Collapsed row */}
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-[15px] text-foreground">{topic.title}</p>
                {topic.target_keyword && (
                  <p className="mt-0.5 truncate text-[13px] text-muted">
                    <code className="text-foreground/70">
                      {topic.target_keyword}
                    </code>
                    {topic.intent ? ` · ${topic.intent}` : ""}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {topic.funnel_stage && <FunnelBadge stage={topic.funnel_stage} />}
                <StatusBadge status={topic.status} />
                {latestDraftByTopic[topic.id] ? (
                  <DraftLink draft={latestDraftByTopic[topic.id]} />
                ) : (
                  <GenerateButton topicId={topic.id} />
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
                  className="text-[13px] text-muted transition-colors hover:text-foreground"
                >
                  {editingTopicId === topic.id ? "Cancel" : "Edit"}
                </button>
              </div>
            </div>

            {/* Inline edit panel */}
            {editingTopicId === topic.id && (
              <div className="border-t border-border bg-surface-2/40 px-4 py-4">
                <TopicFields
                  formData={formData}
                  onChange={setFormData}
                  saving={saving}
                />
                {error && <p className="mt-2 text-xs text-danger">{error}</p>}
                <div className="mt-4 flex items-center gap-2">
                  <Button
                    variant="solid"
                    size="sm"
                    onClick={() => handleUpdateTopic(topic.id)}
                    loading={saving}
                    disabled={!formData.title.trim()}
                  >
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingTopicId(null)}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  {topic.status === "idea" && (
                    <button
                      onClick={() => handleDeleteTopic(topic.id)}
                      disabled={saving}
                      className="ml-auto text-[13px] text-danger transition-colors hover:opacity-80 disabled:opacity-50"
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
          <li className="bg-surface-2/40 px-4 py-4">
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
              New topic
            </p>
            <TopicFields
              formData={formData}
              onChange={setFormData}
              saving={saving}
            />
            {error && <p className="mt-2 text-xs text-danger">{error}</p>}
            <div className="mt-4 flex items-center gap-2">
              <Button
                variant="solid"
                size="sm"
                onClick={handleCreateTopic}
                loading={saving}
                disabled={!formData.title.trim()}
              >
                Add topic
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowAddForm(false);
                  setFormData(EMPTY_FORM);
                  setError(null);
                }}
                disabled={saving}
              >
                Cancel
              </Button>
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
            className="text-[13px] font-medium text-accent transition-colors hover:text-accent-press"
          >
            + Add topic
          </button>
        </div>
      )}
    </Card>
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
        <Field label="Title">
          <Input
            type="text"
            value={formData.title}
            onChange={(e) => set("title", e.target.value)}
            disabled={saving}
            placeholder="e.g. How to write a cold email that gets replies"
          />
        </Field>
      </div>

      <Field label="Target keyword">
        <Input
          type="text"
          value={formData.target_keyword}
          onChange={(e) => set("target_keyword", e.target.value)}
          disabled={saving}
          placeholder="e.g. cold email tips"
        />
      </Field>

      <Field label="Intent">
        <Input
          type="text"
          value={formData.intent}
          onChange={(e) => set("intent", e.target.value)}
          disabled={saving}
          placeholder="e.g. informational"
        />
      </Field>

      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-foreground/90">
          Funnel stage
        </label>
        <select
          value={formData.funnel_stage}
          onChange={(e) => set("funnel_stage", e.target.value as FunnelStage | "")}
          disabled={saving}
          className={SELECT_CLS}
        >
          <option value="">Inherit from pillar</option>
          <option value="awareness">Awareness</option>
          <option value="consideration">Consideration</option>
          <option value="decision">Decision</option>
          <option value="brand">Brand</option>
        </select>
      </div>

      <Field label="Maps to product">
        <Input
          type="text"
          value={formData.maps_to_product}
          onChange={(e) => set("maps_to_product", e.target.value)}
          disabled={saving}
          placeholder="e.g. brand-audit"
        />
      </Field>
    </div>
  );
}
