import "server-only";
import type { SanityClient } from "@sanity/client";
import { getSanity, resolveSanityConfig } from "@/lib/clients/sanity";
import { blogCopyToPortableText } from "@/lib/blog/to-portable-text";
import type { BlogCopy, Brand, ContentImage } from "@/lib/db/types";
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
  const filename = hero.url.split("/").pop() ?? "hero.jpg";
  // Uploaded PNGs (transparency preserved) are stored as .png; everything
  // else in the bucket is JPEG.
  const asset = await client.assets.upload("image", bytes, {
    filename,
    contentType: filename.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg",
  });
  return {
    _type: "image" as const,
    asset: { _type: "reference" as const, _ref: asset._id },
    alt: hero.alt,
  };
}

type MainImage = Awaited<ReturnType<typeof uploadMainImage>>;

/**
 * The post document as the site reads it. Published, not a drafts.* doc: the
 * in-app Approve and Publish clicks are the human gate, so a second "make it
 * live" step in the studio only delayed posts (and left publishedAt unset).
 */
export function buildPostDocument(args: {
  jobId: string;
  postType: string;
  copy: BlogCopy;
  mainImage?: MainImage;
  publishedAt: string;
}) {
  const { copy } = args;
  return {
    _id: `content-engine-${args.jobId}`,
    _type: args.postType,
    title: copy.title,
    slug: { _type: "slug", current: copy.slug },
    publishedAt: args.publishedAt,
    metaTitle: copy.meta_title,
    metaDescription: copy.meta_description,
    excerpt: copy.meta_description,
    ...(args.mainImage ? { mainImage: args.mainImage } : {}),
    ...(copy.faq?.length
      ? {
          faq: copy.faq.map((item, i) => ({
            _key: `faq-${i}`,
            _type: "faqItem",
            question: item.question,
            answer: item.answer,
          })),
        }
      : {}),
    body: blogCopyToPortableText(copy),
  };
}

/**
 * The public post URL, from the brand's website in Settings. Stored as the
 * topic's published_url, which is what internal linking reads back. Null when
 * no website is set, so a wrong URL is never recorded.
 */
export function livePostUrl(brand: Brand, slug: string): string | null {
  const site = brand.visual_identity?.footer?.website?.trim();
  if (!site) return null;
  const origin = /^https?:\/\//i.test(site) ? site : `https://${site}`;
  return `${origin.replace(/\/+$/, "")}/blog/${slug}`;
}

/**
 * Publishes an approved blog draft live to Sanity. Doubly idempotent: the
 * pipeline checks the publications row first, and the document _id is
 * deterministic per job with createIfNotExists, so even a raced retry can
 * never produce a second doc.
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

    const doc = buildPostDocument({
      jobId: input.jobId,
      postType: config.postType,
      copy,
      mainImage,
      publishedAt: new Date().toISOString(),
    });

    const created = await client.createIfNotExists(doc);

    return {
      externalId: created._id,
      url: livePostUrl(input.brand, copy.slug) ?? undefined,
    };
  },
};
