import { beforeEach, describe, expect, it, vi } from "vitest";

// The pipeline's idempotency rules are the point of these tests: an existing
// publication must never be re-created, but one stuck in "draft" (created at
// the destination, never delivered) must still be able to retry delivery.
const getDraftWithJobContext = vi.fn();
const getBrandByDraftId = vi.fn();
const getBrandIntegrations = vi.fn();
const getPublication = vi.fn();
const recordPublication = vi.fn();
const updatePublicationDelivery = vi.fn();
const markJobPublished = vi.fn();

vi.mock("@/lib/db/queries", () => ({
  getDraftWithJobContext: (...a: unknown[]) => getDraftWithJobContext(...a),
  getBrandByDraftId: (...a: unknown[]) => getBrandByDraftId(...a),
  getBrandIntegrations: (...a: unknown[]) => getBrandIntegrations(...a),
  getPublication: (...a: unknown[]) => getPublication(...a),
  recordPublication: (...a: unknown[]) => recordPublication(...a),
  updatePublicationDelivery: (...a: unknown[]) => updatePublicationDelivery(...a),
  markJobPublished: (...a: unknown[]) => markJobPublished(...a),
}));

const publishFn = vi.fn();
const scheduleExistingFn = vi.fn();
const provider = {
  id: "mailerlite",
  kind: "email",
  label: "MailerLite (email)",
  configHint: "",
  fields: [],
  isConfigured: () => true,
  publish: publishFn,
  scheduleExisting: scheduleExistingFn,
};

vi.mock("@/lib/publishing/registry", () => ({
  getProvider: () => provider,
  providersForKind: () => [provider],
}));

import { publishDraft } from "./publish";

beforeEach(() => {
  vi.clearAllMocks();
  getDraftWithJobContext.mockResolvedValue({
    draftId: "draft-1",
    jobId: "job-1",
    jobType: "email",
    state: "approved",
    content: { subject: "s", html: "<p>{$unsubscribe}</p>" },
    meta: {},
  });
  getBrandByDraftId.mockResolvedValue({ id: "brand-1" });
  getBrandIntegrations.mockResolvedValue([]);
});

describe("publishDraft idempotency", () => {
  it("retries delivery for a publication stuck in draft, without re-publishing", async () => {
    getPublication.mockResolvedValue({
      job_id: "job-1",
      target: "mailerlite",
      external_id: "42",
      url: "https://dashboard.mailerlite.com/campaigns/42",
      status: "draft",
      scheduled_for: null,
    });
    scheduleExistingFn.mockResolvedValue({
      externalId: "42",
      status: "scheduled",
      scheduledFor: "2030-01-02T09:30:00",
    });
    updatePublicationDelivery.mockResolvedValue({
      url: "https://dashboard.mailerlite.com/campaigns/42",
      status: "scheduled",
      scheduled_for: "2030-01-02T09:30:00",
    });

    const out = await publishDraft("draft-1", "mailerlite", {
      type: "scheduled",
      date: "2030-01-02",
      hours: "09",
      minutes: "30",
    });

    // The whole point: delivery retried, campaign NOT re-created.
    expect(scheduleExistingFn).toHaveBeenCalledOnce();
    expect(publishFn).not.toHaveBeenCalled();
    expect(recordPublication).not.toHaveBeenCalled();
    expect(out.status).toBe("scheduled");
    expect(out.alreadyPublished).toBe(false);
    expect(out.externalId).toBe("42");
  });

  it("still short-circuits an already-sent publication", async () => {
    getPublication.mockResolvedValue({
      job_id: "job-1",
      target: "mailerlite",
      external_id: "42",
      url: null,
      status: "sent",
      scheduled_for: null,
    });

    const out = await publishDraft("draft-1", "mailerlite");

    expect(out.alreadyPublished).toBe(true);
    expect(publishFn).not.toHaveBeenCalled();
    expect(scheduleExistingFn).not.toHaveBeenCalled();
    expect(updatePublicationDelivery).not.toHaveBeenCalled();
  });

  it("publishes normally when there is no existing publication", async () => {
    getPublication.mockResolvedValue(null);
    publishFn.mockResolvedValue({ externalId: "99", status: "sent" });
    recordPublication.mockResolvedValue({
      external_id: "99",
      url: null,
      status: "sent",
      scheduled_for: null,
    });

    const out = await publishDraft("draft-1", "mailerlite");

    expect(publishFn).toHaveBeenCalledOnce();
    expect(out.status).toBe("sent");
    expect(markJobPublished).toHaveBeenCalled();
  });

  it("refuses to publish a draft that isn't approved", async () => {
    getDraftWithJobContext.mockResolvedValue({
      draftId: "draft-1",
      jobId: "job-1",
      jobType: "email",
      state: "in_review",
      content: { subject: "s", html: "" },
      meta: {},
    });

    await expect(publishDraft("draft-1", "mailerlite")).rejects.toThrow(
      /approved/i,
    );
    expect(publishFn).not.toHaveBeenCalled();
  });
});
