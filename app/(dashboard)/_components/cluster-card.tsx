"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog, Field, Input, Select, useToast } from "@/components/ui";
import type {
  ClusterWithTopics,
  FunnelStage,
  Topic,
  TopicFormData,
} from "@/lib/db/types";
import { StatusBadge, FunnelBadge, KeywordBadge, DraftLink } from "./topic-badges";
import { GenerateButton } from "./generate-button";
import { ResearchButton } from "./research-button";

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
  /** When false (default), archived topics are hidden entirely. */
  showArchived?: boolean;
  /** brand.seo_defaults.keyword_difficulty_max, for coloring KeywordBadge. */
  keywordDifficultyMax?: number;
}

export function ClusterCard({
  cluster,
  latestDraftByTopic,
  showArchived = false,
  keywordDifficultyMax,
}: ClusterCardProps) {
  const router = useRouter();
  const toast = useToast();
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState<TopicFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const visibleTopics = cluster.topics.filter((t) => showArchived || !t.archived);

  async function handleUpdateTopic(topicId: string) {
    setSaving(true);
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
      toast.error(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateTopic() {
    setSaving(true);
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
      toast.error(e instanceof Error ? e.message : "Failed to create.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTopic(topicId: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/topics/${topicId}`, { method: "DELETE" });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? "Failed to delete.");
      }
      setEditingTopicId(null);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete.");
    } finally {
      setSaving(false);
      setConfirmDeleteId(null);
    }
  }

  async function handleToggleArchive(topicId: string, archive: boolean) {
    setSaving(true);
    try {
      const res = await fetch(`/api/topics/${topicId}/archive`, {
        method: archive ? "POST" : "DELETE",
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? "Failed to update.");
      }
      setEditingTopicId(null);
      toast.success(archive ? "Topic archived." : "Topic unarchived.");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update.");
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
        {visibleTopics.map((topic) => (
          <li key={topic.id} className={topic.archived ? "opacity-60" : undefined}>
            {/* Collapsed row */}
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-[15px] text-foreground">
                  {topic.title}
                  {topic.archived && (
                    <span className="ml-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                      Archived
                    </span>
                  )}
                </p>
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
                {topic.target_keyword &&
                  (topic.keyword_data?.primary ? (
                    <KeywordBadge
                      data={topic.keyword_data.primary}
                      difficultyMax={keywordDifficultyMax}
                    />
                  ) : (
                    <ResearchButton topicId={topic.id} />
                  ))}
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
                  <button
                    onClick={() => handleToggleArchive(topic.id, !topic.archived)}
                    disabled={saving}
                    className="ml-auto text-[13px] text-muted transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    {topic.archived ? "Unarchive" : "Archive"}
                  </button>
                  {topic.status === "idea" && (
                    <button
                      onClick={() => setConfirmDeleteId(topic.id)}
                      disabled={saving}
                      className="text-[13px] text-danger transition-colors hover:opacity-80 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}

        {visibleTopics.length === 0 && !showAddForm && (
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
            }}
            className="text-[13px] font-medium text-accent transition-colors hover:text-accent-press"
          >
            + Add topic
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => confirmDeleteId && handleDeleteTopic(confirmDeleteId)}
        tone="danger"
        title="Delete this topic?"
        description="This cannot be undone."
        confirmLabel="Delete"
        loading={saving}
      />
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

      <Field label="Funnel stage">
        <Select
          value={formData.funnel_stage}
          onChange={(e) => set("funnel_stage", e.target.value as FunnelStage | "")}
          disabled={saving}
        >
          <option value="">Inherit from pillar</option>
          <option value="awareness">Awareness</option>
          <option value="consideration">Consideration</option>
          <option value="decision">Decision</option>
          <option value="brand">Brand</option>
        </Select>
      </Field>

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
