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
