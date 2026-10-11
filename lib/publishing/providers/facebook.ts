import "server-only";
import { graph, storedPageToken } from "@/lib/clients/meta";
import { buildSocialCaption } from "@/lib/social/caption";
import type { ProviderField, PublishInput, PublishProvider, PublishResult } from "../provider";

// Posts an approved flyer to the connected Facebook Page as a photo post:
//   POST /{page-id}/photos  url=<public JPEG>  caption=<text>  access_token=<Page token>
//   → { id, post_id }
// (`message` is deprecated on this edge; `caption` is the documented field.)
// The Page and its token come only from Connect with Facebook, so there is no
// env fallback. Meta has no idempotency key: retries are guarded by the
// publications row that publishDraft checks before every call.

export const FACEBOOK_FIELDS: ProviderField[] = [
  { key: "pageName", label: "Facebook Page" },
  { key: "pageToken", label: "Page access", secret: true },
];

export const META_OAUTH_START = "/api/connections/meta/start";

export const facebookProvider: PublishProvider = {
  id: "facebook",
  kind: "social",
  label: "Facebook Page",
  configHint: "Connect with Facebook",
  fields: FACEBOOK_FIELDS,
  oauthStartPath: META_OAUTH_START,

  isConfigured: (_brand, integration) =>
    !!storedPageToken(integration) && typeof integration?.config?.pageId === "string",

  async publish(input: PublishInput): Promise<PublishResult> {
    const image = input.meta.flyer_image;
    const copy = input.meta.flyer_copy;
    if (!image || !copy) throw new Error("This draft has no flyer to post.");
    const token = storedPageToken(input.integration);
    const pageId = input.integration?.config?.pageId;
    if (!token || typeof pageId !== "string") {
      throw new Error("Facebook isn't connected. Connect it in Settings → Connections.");
    }

    const posted = await graph<{ id: string; post_id?: string }>("POST", `/${pageId}/photos`, {
      url: image.url,
      caption: buildSocialCaption(copy),
      access_token: token,
    });
    const postId = posted.post_id ?? posted.id;
    return { externalId: postId, url: `https://www.facebook.com/${postId}` };
  },
};
