import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import { mailerliteProvider } from "./mailerlite";
import { logError } from "@/lib/log";
import type { Brand, BrandIntegration } from "@/lib/db/types";
import type { PublishInput } from "../provider";

// The two calls MailerLite needs: create, then deliver. They're separate
// endpoints, and only the second is safe to retry — that asymmetry is what
// most of these tests pin down.
const CREATE = "https://connect.mailerlite.com/api/campaigns";
const scheduleUrl = (id: string) => `${CREATE}/${id}/schedule`;

const brand = {
  id: "brand-1",
  mailerlite_config: {
    sender_name: "Mogul",
    sender_email: "hi@moguldesign.agency",
    group_ids: ["group-1"],
  },
} as unknown as Brand;

const integration = null as BrandIntegration | null;

function publishInput(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    jobId: "job-1",
    draftId: "draft-1",
    content: {
      subject: "A subject",
      html: "<p>Body {$unsubscribe}</p>",
    },
    meta: {},
    brand,
    integration,
    ...overrides,
  } as PublishInput;
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(logError).mockClear();
  process.env.MAILERLITE_API_KEY = "test-key";
});

describe("mailerlite publish", () => {
  it("creates then delivers instantly", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 42 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: "sent" } }));

    const result = await mailerliteProvider.publish(publishInput());

    expect(result.status).toBe("sent");
    expect(result.externalId).toBe("42");
    expect(fetchMock.mock.calls[0][0]).toBe(CREATE);
    expect(fetchMock.mock.calls[1][0]).toBe(scheduleUrl("42"));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      delivery: "instant",
    });
  });

  it("sends the scheduled delivery shape MailerLite documents", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 7 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: "ready" } }));

    const result = await mailerliteProvider.publish(
      publishInput({
        schedule: {
          type: "scheduled",
          date: "2030-01-02",
          hours: "09",
          minutes: "30",
        },
      }),
    );

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      delivery: "scheduled",
      schedule: { date: "2030-01-02", hours: "09", minutes: "30" },
    });
    expect(result.status).toBe("scheduled");
    expect(result.scheduledFor).toBe("2030-01-02T09:30:00");
  });

  it("refuses before creating anything when no group is set", async () => {
    const noGroups = {
      ...brand,
      mailerlite_config: {
        sender_name: "Mogul",
        sender_email: "hi@moguldesign.agency",
        group_ids: [],
      },
    } as unknown as Brand;

    await expect(
      mailerliteProvider.publish(publishInput({ brand: noGroups })),
    ).rejects.toThrow(/audience group/i);
    // The critical part: no campaign was created, so there's no orphan.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns draft + logs the raw reason when delivery is rejected", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 9 } }))
      .mockResolvedValueOnce(
        jsonResponse({ message: "Campaign settings missing" }, false, 422),
      );

    const result = await mailerliteProvider.publish(publishInput());

    // Never throws: the campaign exists, so throwing would send a retry back
    // through create and duplicate it.
    expect(result.status).toBe("draft");
    expect(result.externalId).toBe("9");
    expect(result.scheduleError).toContain("422");
    expect(result.scheduleError).toContain("Campaign settings missing");
    expect(logError).toHaveBeenCalledWith(
      "publish:mailerlite:schedule",
      expect.stringContaining("Campaign settings missing"),
      expect.objectContaining({ campaignId: "9" }),
    );
  });
});

describe("mailerlite scheduleExisting", () => {
  it("only hits the schedule endpoint, never creates a second campaign", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { status: "ready" } }));

    const result = await mailerliteProvider.scheduleExisting!({
      externalId: "55",
      schedule: {
        type: "scheduled",
        date: "2030-05-05",
        hours: "14",
        minutes: "00",
      },
      brand,
      integration,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(scheduleUrl("55"));
    expect(result.status).toBe("scheduled");
    expect(result.externalId).toBe("55");
  });

  it("stays retryable when the retry itself fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "nope" }, false, 422));

    const result = await mailerliteProvider.scheduleExisting!({
      externalId: "55",
      brand,
      integration,
    });

    expect(result.status).toBe("draft");
    expect(result.scheduleError).toContain("422");
  });
});

// Editing after publishing. The whole point is that approving isn't final:
// as long as MailerLite still holds the campaign as draft or ready, the fixed
// email lands on that SAME campaign id rather than a duplicate.
describe("mailerlite updatePublished", () => {
  const updateInput = (overrides: Record<string, unknown> = {}) =>
    ({ ...publishInput(), externalId: "42", ...overrides }) as never;

  const campaignUrl = `${CREATE}/42`;

  it("edits a draft campaign in place and re-delivers it", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { status: "draft" } })) // GET
      .mockResolvedValueOnce(jsonResponse({ data: { id: 42 } })) // PUT
      .mockResolvedValueOnce(jsonResponse({ data: { status: "sent" } })); // deliver

    const result = await mailerliteProvider.updatePublished!(updateInput());

    expect(fetchMock.mock.calls[1][0]).toBe(campaignUrl);
    expect(fetchMock.mock.calls[1][1].method).toBe("PUT");
    expect(result.externalId).toBe("42");
    expect(result.recreated).toBeUndefined();
    expect(result.status).toBe("sent");
  });

  it("cancels a scheduled campaign first, since MailerLite only edits drafts", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { status: "ready" } })) // GET
      .mockResolvedValueOnce(jsonResponse({ data: {} })) // cancel
      .mockResolvedValueOnce(jsonResponse({ data: { id: 42 } })) // PUT
      .mockResolvedValueOnce(jsonResponse({ data: { status: "ready" } })); // deliver

    await mailerliteProvider.updatePublished!(updateInput());

    expect(fetchMock.mock.calls[1][0]).toBe(`${campaignUrl}/cancel`);
    expect(fetchMock.mock.calls[2][1].method).toBe("PUT");
  });

  it("refuses a sent campaign unless recreating was explicitly allowed", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { status: "sent" } }));

    await expect(
      mailerliteProvider.updatePublished!(updateInput()),
    ).rejects.toThrow(/already gone out/);
    // Nothing beyond the status read: no edit, no second campaign.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates a new campaign when the caller opts into resending a sent one", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { status: "sent" } })) // GET
      .mockResolvedValueOnce(jsonResponse({ data: { id: 99 } })) // create
      .mockResolvedValueOnce(jsonResponse({ data: { status: "sent" } })); // deliver

    const result = await mailerliteProvider.updatePublished!(
      updateInput({ allowRecreate: true }),
    );

    expect(fetchMock.mock.calls[1][0]).toBe(CREATE);
    expect(result.externalId).toBe("99");
    expect(result.recreated).toBe(true);
  });

  it("recreates a campaign that no longer exists at MailerLite", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: "gone" }, false, 404))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 77 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: "sent" } }));

    const result = await mailerliteProvider.updatePublished!(updateInput());

    expect(result.externalId).toBe("77");
    expect(result.recreated).toBe(true);
  });

  it("says the send is off when an unschedule succeeded but the edit failed", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { status: "ready" } }))
      .mockResolvedValueOnce(jsonResponse({ data: {} })) // cancel succeeded
      .mockResolvedValueOnce(jsonResponse({ message: "bad" }, false, 422));

    await expect(
      mailerliteProvider.updatePublished!(updateInput()),
    ).rejects.toThrow(/now unscheduled/);
  });
});

// Webhook registration. Shapes verified against
// developers.mailerlite.com/docs/webhooks.html: POST /api/webhooks returns
// { data: { id, secret } }, and `batchable: true` is REQUIRED for
// campaign.open / campaign.click (which is why this is two subscriptions, not
// one — campaign.sent is not batchable).
describe("mailerlite registerWebhooks", () => {
  const callbackUrl = "https://app.example.com/api/webhooks/mailerlite/tok";

  it("registers a non-batchable sent hook and a batchable open/click hook", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 1, secret: "s1" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 2, secret: "s2" } }));

    const result = await mailerliteProvider.registerWebhooks!({
      brand,
      integration,
      callbackUrl,
    });

    expect(result.webhookIds).toEqual(["1", "2"]);
    expect(result.signingSecret).toBe("s1,s2");

    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(first).toMatchObject({ events: ["campaign.sent"], url: callbackUrl });
    expect(first.batchable).toBeUndefined();

    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second).toMatchObject({
      events: ["campaign.open", "campaign.click"],
      batchable: true,
    });
  });

  it("deletes the previous subscriptions instead of accumulating duplicates", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 3, secret: "s3" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 4, secret: "s4" } }));

    await mailerliteProvider.registerWebhooks!({
      brand,
      integration: {
        config: { webhookIds: ["1", "2"] },
      } as unknown as BrandIntegration,
      callbackUrl,
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://connect.mailerlite.com/api/webhooks/1",
    );
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://connect.mailerlite.com/api/webhooks/2",
    );
  });

  it("rolls back a partial registration so no orphan subscription is left", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: 1, secret: "s1" } }))
      .mockResolvedValueOnce(jsonResponse({ message: "nope" }, false, 422))
      .mockResolvedValueOnce(jsonResponse({}));

    await expect(
      mailerliteProvider.registerWebhooks!({ brand, integration, callbackUrl }),
    ).rejects.toThrow(/webhook registration failed \(422\)/);

    expect(fetchMock.mock.calls[2][0]).toBe(
      "https://connect.mailerlite.com/api/webhooks/1",
    );
    expect(fetchMock.mock.calls[2][1].method).toBe("DELETE");
  });

  it("treats an already-deleted subscription as removed, not an error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "gone" }, false, 404));

    await expect(
      mailerliteProvider.removeWebhooks!({
        brand,
        integration,
        webhookIds: ["9"],
      }),
    ).resolves.toBeUndefined();
    expect(logError).not.toHaveBeenCalled();
  });
});
