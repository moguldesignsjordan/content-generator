import "server-only";
import { load } from "cheerio";
import type { Element } from "domhandler";
import { escapeHtml } from "./templates/shared";
import type { BrandTokens } from "./templates/types";

// Deterministic logo repair for model-designed emails, the same "prompt
// compliance is never trusted for guarantees" pattern as dark-mode.ts. The
// design prompt (prompts/email-design.ts buildFooterChrome) tells the model
// to reuse the real uploaded logo <img> in the footer, same as the header,
// whenever tokens.logo_url is set. In practice it sometimes still types the
// text-wordmark alternative it's shown for the no-logo case. This repairs it
// mechanically after generation rather than trusting compliance.

const REGION_SIZE = {
  header: { maxWidth: 170, maxHeight: 48 },
  footer: { maxWidth: 120, maxHeight: 28 },
} as const;

type Region = keyof typeof REGION_SIZE;

function logoImgTag(tokens: BrandTokens, region: Region): string {
  const { maxWidth, maxHeight } = REGION_SIZE[region];
  return (
    `<img src="${escapeHtml(tokens.logo_url as string)}" alt="${escapeHtml(tokens.logo_alt)}" ` +
    `style="display:inline-block;max-width:${maxWidth}px;max-height:${maxHeight}px;" />`
  );
}

function repairRegion(
  $: ReturnType<typeof load>,
  region: Region,
  tokens: BrandTokens,
): void {
  const scope = $(`[data-region="${region}"]`).first();
  if (!scope.length) return;
  // Already carries the real logo somewhere in this region: nothing to fix.
  if (scope.find(`img[src="${tokens.logo_url}"]`).length) return;

  // The model's text stand-in reliably names the brand (logo_alt, or the
  // sender_name it also has in context) — find the element whose OWN text
  // (not a descendant's) starts with one of those and swap just that node.
  const needles = Array.from(
    new Set(
      [tokens.logo_alt, tokens.sender_name]
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  if (!needles.length) return;

  let target: Element | null = null;
  scope
    .find("*")
    .addBack()
    .each((_, el) => {
      if (target || el.type !== "tag") return;
      const ownText = $(el)
        .contents()
        .filter((_, c) => c.type === "text")
        .text()
        .trim()
        .toLowerCase();
      if (ownText && needles.some((n) => ownText.startsWith(n))) {
        target = el;
      }
    });

  if (target) {
    $(target).empty().append(logoImgTag(tokens, region));
    return;
  }

  // No text wordmark found to swap (unusual shape): guarantee a real logo is
  // at least present by prepending it as the region's first element.
  scope.prepend(`<div>${logoImgTag(tokens, region)}</div>`);
}

/**
 * When the brand has a real uploaded logo, guarantees the header and footer
 * regions both render the actual <img>, never a text-wordmark stand-in.
 * No-ops when logo_url is unset (the wordmark IS the correct look then).
 */
export function ensureBrandLogo(html: string, tokens: BrandTokens): string {
  if (!tokens.logo_url) return html;
  const $ = load(html);
  repairRegion($, "header", tokens);
  repairRegion($, "footer", tokens);
  return $.html();
}
