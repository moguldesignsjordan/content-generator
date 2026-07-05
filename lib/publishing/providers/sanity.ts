import "server-only";
import type { SanityClient } from "@sanity/client";
import { getSanity, resolveSanityConfig } from "@/lib/clients/sanity";
import { blogCopyToPortableText } from "@/lib/blog/to-portable-text";
import type { ContentImage } from "@/lib/db/types";
import type {
  ProviderField,
  PublishInput,
  PublishProvider,
  PublishResult,
} from "../provider";

export const SANITY_FIELDS: ProviderField[] = [
  {
    key: "projectId",
    label: "Project ID",
    envVar: "SANITY_PROJECT_ID",
    hint: "From sanity.io/manage → your project.",
  },
  {
    key: "dataset",
    label: "Dataset",
    placeholder: "production",
    envVar: "SANITY_DATASET",
    optional: true,
    hint: "Defaults to production.",
  },
  {
    key: "writeToken",
    label: "Write token",
    secret: true,
    envVar: "SANITY_WRITE_TOKEN",
    hint: "A token with write access to your dataset. Leave blank to keep the saved value.",
  },
  {
    key: "postType",
    label: "Post type",
    placeholder: "post",
    envVar: "SANITY_POST_TYPE",
    optional: true,
    hint: "The studio document type blog posts are written as. Defaults to post.",
  },
];

/**
 * Mirrors the draft's hero image into Sanity as an image asset and returns
 * the mainImage field value. Fails loudly rather than silently shipping the
 * post without the image the reviewer approved; publishing is retry-safe
 * (the publications row is only recorded after success), and Sanity dedupes
 * identical asset bytes, so a retried upload never piles up copies.
 */
async function uploadMainImage(
  client: SanityClient,
  hero: ContentImage,
) {
  const res = await fetch(hero.url);
  if (!res.ok) {
    throw new Error("Couldn't fetch the post's hero image to send to Sanity.");
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const asset = await client.assets.upload("image", bytes, {
    filename: hero.url.split("/").pop() ?? "hero.jpg",
    contentType: "image/jpeg",
  });
  return {
    _type: "image" as const,
    asset: { _type: "reference" as const, _ref: asset._id },
    alt: hero.alt,
  };
}

/**
 * Publishes an approved blog draft as a Sanity DRAFT document (drafts. id
 * prefix), so the final "make it live" click stays in the studio where the
 * site team works. Doubly idempotent: the pipeline checks the publications
 * row first, and the document _id is deterministic per job with
 * createIfNotExists, so even a raced retry can never produce a second doc.
 */
export const sanityProvider: PublishProvider = {
  id: "sanity",
  kind: "blog",
  label: "Sanity (blog)",
  configHint: "SANITY_PROJECT_ID, SANITY_DATASET, SANITY_WRITE_TOKEN",
  fields: SANITY_FIELDS,

  isConfigured: (_brand, integration) => resolveSanityConfig(integration) !== null,

  async publish(input: PublishInput): Promise<PublishResult> {
    const copy = input.meta.blog_copy;
    if (!copy) {
      throw new Error("Draft has no blog_copy; only blog drafts publish to Sanity.");
    }

    const config = resolveSanityConfig(input.integration);
    if (!config) {
      throw new Error(
        "Sanity is not configured. Connect it in Settings → Connections or set the env vars.",
      );
    }
    const client = getSanity(config);

    const hero = input.meta.hero_image;
    const mainImage = hero ? await uploadMainImage(client, hero) : undefined;

    const documentId = `drafts.content-engine-${input.jobId}`;
    const doc = {
      _id: documentId,
      _type: config.postType,
      title: copy.title,
      slug: { _type: "slug", current: copy.slug },
      // Studio schemas vary; extra fields are harmless at the API layer and
      // useful where the schema has them.
      metaTitle: copy.meta_title,
      metaDescription: copy.meta_description,
      excerpt: copy.meta_description,
      ...(mainImage ? { mainImage } : {}),
      body: blogCopyToPortableText(copy),
    };

    const created = await client.createIfNotExists(doc);

    return {
      externalId: created._id,
      url: `https://www.sanity.io/manage/project/${config.projectId}`,
    };
  },
};
