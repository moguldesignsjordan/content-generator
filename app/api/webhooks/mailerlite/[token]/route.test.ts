import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Unlike the Stripe route's test, the signature path here is exercised for
// real: the scheme is plain HMAC-SHA256 over the raw body (verified against
// developers.mailerlite.com/docs/webhooks.html), so a genuine signature can be
// produced in-test with no live credentials. What's mocked is everything with
// a side effect: the DB, and the stats refresh.

const SECRET = "s3cret";

const getBrandIntegrationByWebhookToken = vi.fn();
const getPublicationByExternalId = vi.fn();
const getBrandIdForPublication = vi.fn();
const getBrandById = vi.fn();
const updatePublicationStatus = vi.fn().mockResolvedValue(undefined);
const recordWebhookEvent = vi.fn();
const finishWebhookEvent = vi.fn().mockResolvedValue(undefined);
const refreshPerformanceForPublication = vi.fn().mockResolvedValue(true);

vi.mock("@/lib/db/queries", () => ({
  getBrandIntegrationByWebhookToken: (...a: unknown[]) =>
    getBrandIntegrationByWebhookToken(...a),
  getPublicationByExternalId: (...a: unknown[]) => getPublicationByExternalId(...a),
  getBrandIdForPublication: (...a: unknown[]) => getBrandIdForPublication(...a),
  getBrandById: (...a: unknown[]) => getBrandById(...a),
  updatePublicationStatus: (...a: unknown[]) => updatePublicationStatus(...a),
  recordWebhookEvent: (...a: unknown[]) => recordWebhookEvent(...a),
  finishWebhookEvent: (...a: unknown[]) => finishWebhookEvent(...a),
}));
vi.mock("@/lib/pipeline/performance", () => ({
  refreshPerformanceForPublication: (...a: unknown[]) =>
    refreshPerformanceForPublication(...a),
}));
// The connection stores the secret encrypted; decryption itself is covered by
// lib/crypto's own tests, so hand the route the plaintext directly.
vi.mock("@/lib/publishing/credentials", () => ({
  resolveSecret: () => SECRET,
}));
vi.mock("@/lib/log", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

const { POST } = await import("./route");

function post(body: string, signature?: string) {
  const sig =
    signature ?? createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
  return new NextRequest("http://localhost:3000/api/webhooks/mailerlite/tok", {
    method: "POST",
    headers: { Signature: sig },
    body,
  });
}

const ctx = { params: Promise.resolve({ token: "tok" }) };

const SENT = JSON.stringify({
  id: "77",
  name: "July newsletter",
  event: "campaign.sent",
  account_id: "1",
});

beforeEach(() => {
  vi.clearAllMocks();
  getBrandIntegrationByWebhookToken.mockResolvedValue({
    id: "int-1",
    brand_id: "brand-1",
    provider_id: "mailerlite",
    config: {},
  });
  recordWebhookEvent.mockResolvedValue({ id: "evt-1" });
  getPublicationByExternalId.mockResolvedValue({
    id: "pub-1",
    target: "mailerlite",
    external_id: "77",
    status: "scheduled",
  });
  getBrandIdForPublication.mockResolvedValue("brand-1");
  getBrandById.mockResolvedValue({ id: "brand-1" });
  refreshPerformanceForPublication.mockResolvedValue(true);
});

describe("POST /api/webhooks/mailerlite/[token]", () => {
  it("marks the publication sent and force-refreshes stats on campaign.sent", async () => {
    const res = await POST(post(SENT), ctx);
    expect(res.status).toBe(200);
    expect(updatePublicationStatus).toHaveBeenCalledWith("pub-1", "sent");
    expect(refreshPerformanceForPublication).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pub-1" }),
      expect.objectContaining({ id: "brand-1" }),
      { force: true },
    );
    expect(finishWebhookEvent).toHaveBeenCalledWith("evt-1");
  });

  it("rejects a bad signature without touching the DB", async () => {
    const res = await POST(post(SENT, "deadbeef"), ctx);
    expect(res.status).toBe(401);
    expect(recordWebhookEvent).not.toHaveBeenCalled();
    expect(refreshPerformanceForPublication).not.toHaveBeenCalled();
  });

  it("rejects an unknown token before any signature work", async () => {
    getBrandIntegrationByWebhookToken.mockResolvedValue(null);
    const res = await POST(post(SENT), ctx);
    expect(res.status).toBe(404);
    expect(recordWebhookEvent).not.toHaveBeenCalled();
  });

  it("short-circuits a duplicate delivery without re-running side effects", async () => {
    recordWebhookEvent.mockResolvedValue(null); // unique(provider, body_hash) hit
    const res = await POST(post(SENT), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(updatePublicationStatus).not.toHaveBeenCalled();
    expect(refreshPerformanceForPublication).not.toHaveBeenCalled();
  });

  it("collapses a batched open payload into ONE debounced refresh", async () => {
    const body = JSON.stringify({
      total: 3,
      events: [
        { type: "campaign.open", campaign: { id: "77" }, subscriber: { id: "1" } },
        { type: "campaign.open", campaign: { id: "77" }, subscriber: { id: "2" } },
        { type: "campaign.click", campaign: { id: "77" }, subscriber: { id: "3" } },
      ],
    });
    const res = await POST(post(body), ctx);
    expect(res.status).toBe(200);
    expect(refreshPerformanceForPublication).toHaveBeenCalledTimes(1);
    // Not force: opens/clicks take the 15-minute debounce.
    expect(refreshPerformanceForPublication).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { force: false },
    );
    // Not a send event, so delivery status is left alone.
    expect(updatePublicationStatus).not.toHaveBeenCalled();
  });

  it("refuses to touch a campaign belonging to another brand", async () => {
    getBrandIdForPublication.mockResolvedValue("brand-2");
    const res = await POST(post(SENT), ctx);
    expect(res.status).toBe(200);
    expect(updatePublicationStatus).not.toHaveBeenCalled();
    expect(refreshPerformanceForPublication).not.toHaveBeenCalled();
  });

  it("ignores an event for a campaign this app never published", async () => {
    getPublicationByExternalId.mockResolvedValue(null);
    const res = await POST(post(SENT), ctx);
    expect(res.status).toBe(200);
    expect(refreshPerformanceForPublication).not.toHaveBeenCalled();
  });

  it("200s on an unhandled event type so MailerLite stops retrying it", async () => {
    const body = JSON.stringify({ event: "subscriber.created", id: "5" });
    const res = await POST(post(body), ctx);
    expect(res.status).toBe(200);
    expect(refreshPerformanceForPublication).not.toHaveBeenCalled();
  });

  it("200s but records the error when handling throws", async () => {
    getBrandById.mockRejectedValue(new Error("db down"));
    const res = await POST(post(SENT), ctx);
    expect(res.status).toBe(200);
    expect(finishWebhookEvent).toHaveBeenCalledWith("evt-1", "db down");
  });

  it("400s on a body that isn't JSON", async () => {
    const res = await POST(post("not json"), ctx);
    expect(res.status).toBe(400);
    expect(recordWebhookEvent).not.toHaveBeenCalled();
  });
});
