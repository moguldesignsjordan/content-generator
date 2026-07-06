"use client";

import { useState } from "react";
import {
  Button,
  ConfirmDialog,
  Field,
  ListGroup,
  ListRow,
  Select,
  useToast,
} from "@/components/ui";
import { TrashIcon } from "@/components/ui/icons";
import type { BlogType, Cadence, ContentJobType, ContentSchedule, EmailType } from "@/lib/db/types";

const CADENCE_OPTIONS: { value: Cadence; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
];

const EMAIL_TYPE_OPTIONS: { value: EmailType; label: string }[] = [
  { value: "newsletter", label: "Newsletter" },
  { value: "product", label: "Product" },
  { value: "service", label: "Service" },
  { value: "promotional", label: "Promotional" },
  { value: "announcement", label: "Announcement" },
];

const BLOG_TYPE_OPTIONS: { value: BlogType; label: string }[] = [
  { value: "pillar", label: "Pillar" },
  { value: "how_to", label: "How-to" },
  { value: "listicle", label: "Listicle" },
  { value: "case_study", label: "Case study" },
  { value: "thought_leadership", label: "Thought leadership" },
  { value: "landing", label: "Landing" },
];

function cadenceLabel(cadence: Cadence): string {
  return CADENCE_OPTIONS.find((o) => o.value === cadence)?.label ?? cadence;
}

function typeLabel(schedule: ContentSchedule): string | null {
  if (schedule.channel === "email" && schedule.email_type) {
    return EMAIL_TYPE_OPTIONS.find((o) => o.value === schedule.email_type)?.label ?? null;
  }
  if (schedule.channel === "blog" && schedule.blog_type) {
    return BLOG_TYPE_OPTIONS.find((o) => o.value === schedule.blog_type)?.label ?? null;
  }
  return null;
}

function scheduleTitle(schedule: ContentSchedule): string {
  const channel = schedule.channel === "email" ? "Email" : "Blog post";
  const type = typeLabel(schedule);
  return `${channel} · ${cadenceLabel(schedule.cadence)}${type ? ` · ${type}` : ""}`;
}

function scheduleSubtitle(schedule: ContentSchedule): string {
  if (!schedule.active) return "Paused";
  if (!schedule.last_run_at) return "Not run yet";
  const last = new Date(schedule.last_run_at).toLocaleDateString();
  return `Last ran ${last} · ${schedule.last_result ?? "no result recorded"}`;
}

/**
 * Settings → Schedules: a schedule auto-generates a draft on a cadence
 * (daily/weekly/biweekly/monthly) for the oldest un-started topic, and
 * leaves it in_review, same approval gate as a manual draft — it never
 * auto-publishes. "Run now" calls the same generation path the daily cron
 * uses, for testing without waiting on the tick.
 */
export function SchedulesForm({
  brandId,
  schedules,
}: {
  brandId: string;
  schedules: ContentSchedule[];
}) {
  const toast = useToast();
  const [items, setItems] = useState(schedules);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [channel, setChannel] = useState<ContentJobType>("email");
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [emailType, setEmailType] = useState<EmailType | "">("");
  const [blogType, setBlogType] = useState<BlogType | "">("");
  const [creating, setCreating] = useState(false);

  async function handleToggleActive(schedule: ContentSchedule) {
    setBusyId(schedule.id);
    try {
      const res = await fetch(`/api/schedules/${schedule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !schedule.active }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        schedule?: ContentSchedule;
        error?: string;
      };
      if (!res.ok || !data.schedule) throw new Error(data.error);
      setItems((cur) => cur.map((s) => (s.id === schedule.id ? data.schedule! : s)));
    } catch {
      toast.error(`Failed to ${schedule.active ? "pause" : "resume"} the schedule.`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleRunNow(schedule: ContentSchedule) {
    setBusyId(schedule.id);
    try {
      const res = await fetch(`/api/schedules/${schedule.id}/run-now`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        status?: "generated" | "skipped" | "error";
        message?: string;
      };
      if (!res.ok) throw new Error();
      if (data.status === "generated") {
        toast.success("Generated a new draft. Check Emails/Blogs for it.");
      } else if (data.status === "skipped") {
        toast.success("Nothing to generate: no un-started topics right now.");
      } else {
        toast.error(data.message ?? "Generation failed.");
      }
    } catch {
      toast.error("Failed to run the schedule.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/schedules/${confirmDeleteId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setItems((cur) => cur.filter((s) => s.id !== confirmDeleteId));
      toast.success("Schedule deleted.");
    } catch {
      toast.error("Failed to delete the schedule.");
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          channel,
          cadence,
          emailType: channel === "email" && emailType ? emailType : undefined,
          blogType: channel === "blog" && blogType ? blogType : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        schedule?: ContentSchedule;
        error?: string;
      };
      if (!res.ok || !data.schedule) throw new Error(data.error);
      setItems((cur) => [data.schedule!, ...cur]);
      setEmailType("");
      setBlogType("");
      toast.success("Schedule created.");
    } catch {
      toast.error("Failed to create the schedule.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-muted">
        Auto-generates a draft on a cadence for the oldest un-started topic and leaves it
        awaiting review, exactly like a manually triggered draft. Nothing publishes on its own.
      </p>

      {items.length > 0 && (
        <ListGroup>
          {items.map((s) => (
            <ListRow
              key={s.id}
              title={scheduleTitle(s)}
              subtitle={scheduleSubtitle(s)}
              chevron={false}
              trailing={
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busyId === s.id}
                    disabled={!!busyId}
                    onClick={() => void handleRunNow(s)}
                  >
                    Run now
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busyId === s.id}
                    disabled={!!busyId}
                    onClick={() => void handleToggleActive(s)}
                  >
                    {s.active ? "Pause" : "Resume"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-danger/10"
                    disabled={!!busyId}
                    onClick={() => setConfirmDeleteId(s.id)}
                    aria-label="Delete schedule"
                  >
                    <TrashIcon size={16} />
                  </Button>
                </div>
              }
            />
          ))}
        </ListGroup>
      )}

      <div className="space-y-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4">
        <p className="text-[13px] font-medium text-foreground">Add a schedule</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Channel">
            <Select
              value={channel}
              onChange={(e) => setChannel(e.target.value as ContentJobType)}
            >
              <option value="email">Email</option>
              <option value="blog">Blog post</option>
            </Select>
          </Field>
          <Field label="Cadence">
            <Select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
              {CADENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {channel === "email" ? (
          <Field label="Email type" hint="Optional. Left unset, generation derives it from the topic.">
            <Select value={emailType} onChange={(e) => setEmailType(e.target.value as EmailType | "")}>
              <option value="">Auto type</option>
              {EMAIL_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Blog format" hint="Optional. Left unset, generation derives it from the topic.">
            <Select value={blogType} onChange={(e) => setBlogType(e.target.value as BlogType | "")}>
              <option value="">Auto format</option>
              {BLOG_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Button variant="gradient" size="sm" loading={creating} onClick={() => void handleCreate()}>
          Add schedule
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => void handleDelete()}
        tone="danger"
        title="Delete this schedule?"
        description="It stops auto-generating drafts. Anything already generated stays as-is."
        confirmLabel="Delete"
        loading={deleting}
      />
    </div>
  );
}
