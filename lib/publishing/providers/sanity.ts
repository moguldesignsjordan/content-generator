import "server-only";
import { SANITY_POST_TYPE, getSanity, isSanityConfigured } from "@/lib/clients/sanity";
import { blogCopyToPortableText } from "@/lib/blog/to-portable-text";
import type { PublishInput, PublishProvider, PublishResult } from "../provider";

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

  isConfigured: () => isSanityConfigured(),

  async publish(input: PublishInput): Promise<PublishResult> {
    const copy = input.meta.blog_copy;
    if (!copy) {
      throw new Error("Draft has no blog_copy; only blog drafts publish to Sanity.");
    }

    const documentId = `drafts.content-engine-${input.jobId}`;
    const doc = {
      _id: documentId,
      _type: SANITY_POST_TYPE,
      title: copy.title,
      slug: { _type: "slug", current: copy.slug },
      // Studio schemas vary; extra fields are harmless at the API layer and
      // useful where the schema has them.
      metaTitle: copy.meta_title,
      metaDescription: copy.meta_description,
      excerpt: copy.meta_description,
      body: blogCopyToPortableText(copy),
    };

    const created = await getSanity().createIfNotExists(doc);

    const projectId = process.env.SANITY_PROJECT_ID!;
    return {
      externalId: created._id,
      url: `https://www.sanity.io/manage/project/${projectId}`,
    };
  },
};
