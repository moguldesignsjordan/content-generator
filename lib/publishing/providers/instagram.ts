import "server-only";
import { graph, storedPageToken } from "@/lib/clients/meta";
import { buildSocialCaption } from "@/lib/social/caption";
import { META_OAUTH_START } from "./facebook";
import type { ProviderField, PublishInput, PublishProvider, PublishResult } from "../provider";

// Posts an approved flyer to the Instagram professional account linked to the
// connected Page (Instagram API with Facebook Login, Page token):
//   POST /{ig-user-id}/media          image_url=<public JPEG> caption  → { id }
//   GET  /{container-id}?fields=status_code   until FINISHED
//   POST /{ig-user-id}/media_publish  creation_id=<container id>      → { id }
// JPEG only (flyers are JPEG). No native scheduling, so timed posts go out
// from our daily cron instead. Accounts get 100 API posts per 24 hours.

export const INSTAGRAM_FIELDS: ProviderField[] = [
  { key: "igUsername", label: "Instagram account" },
  { key: "pageToken", label: "Page access", secret: true },
];

const POLL_MS = 2000;
const POLL_LIMIT = 30;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for Meta to finish fetching the image into the container. */
async function waitForContainer(containerId: string, token: string): Promise<void> {
  for (let i = 0; i < POLL_LIMIT; i++) {
    const { status_code } = await graph<{ status_code?: string }>("GET", `/${containerId}`, {
      fields: "status_code",
      access_token: token,
    });
    if (status_code === "FINISHED" || status_code === "PUBLISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") {
      throw new Error(`Instagram couldn't process the image (${status_code}).`);
    }
    await wait(POLL_MS);
  }
  throw new Error("Instagram took too long to process the image. Try again.");
}

export const instagramProvider: PublishProvider = {
  id: "instagram",
  kind: "social",
  label: "Instagram",
  configHint: "Connect with Facebook",
  fields: INSTAGRAM_FIELDS,
  oauthStartPath: META_OAUTH_START,

  isConfigured: (_brand, integration) =>
    !!storedPageToken(integration) && typeof integration?.config?.igUserId === "string",

  async publish(input: PublishInput): Promise<PublishResult> {
    const image = input.meta.flyer_image;
    const copy = input.meta.flyer_copy;
    if (!image || !copy) throw new Error("This draft has no flyer to post.");
    if (input.meta.flyer_aspect === "9:16") {
      throw new Error("Story-size (9:16) flyers can't post to the Instagram feed. Use 1:1 or 4:5.");
    }
    const token = storedPageToken(input.integration);
    const igUserId = input.integration?.config?.igUserId;
    if (!token || typeof igUserId !== "string") {
      throw new Error("Instagram isn't connected. Connect Facebook in Settings → Connections.");
    }

    const container = await graph<{ id: string }>("POST", `/${igUserId}/media`, {
      image_url: image.url,
      caption: buildSocialCaption(copy),
      access_token: token,
    });
    await waitForContainer(container.id, token);
    const published = await graph<{ id: string }>("POST", `/${igUserId}/media_publish`, {
      creation_id: container.id,
      access_token: token,
    });

    // The permalink is a nicety for the review screen; the post is already up.
    const permalink = await graph<{ permalink?: string }>("GET", `/${published.id}`, {
      fields: "permalink",
      access_token: token,
    })
      .then((r) => r.permalink)
      .catch(() => undefined);

    return { externalId: published.id, url: permalink };
  },
};
