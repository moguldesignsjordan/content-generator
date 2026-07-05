"use client";

import { useState } from "react";
import { Button, Card, Checkbox, Field, Input, Label, Textarea, useToast } from "@/components/ui";
import { ListInput } from "../settings/_components/list-input";
import type {
  BrandColors,
  BrandFonts,
  BrandImportProposal,
  Positioning,
  Product,
  ProposedProduct,
  VisualIdentity,
  VoiceProfile,
} from "@/lib/db/types";

// Review screen for a website-import proposal, shared by Settings and
// Onboarding. Everything is editable; only sections (and products) the user
// keeps checked are saved, via the EXISTING settings PATCH routes, merged
// over the current stored values so untouched fields survive. Nothing here
// persists until "Save selected" is pressed.

interface ImportReviewProps {
  brandId: string;
  brandName: string;
  currentVoice: VoiceProfile;
  currentPositioning: Positioning;
  currentVisual: VisualIdentity;
  existingProducts: Product[];
  proposal: BrandImportProposal;
  onDone: (savedSections: string[]) => void;
}

const COLOR_FIELDS: { key: keyof BrandColors; label: string }[] = [
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "accent", label: "Accent (CTA)" },
  { key: "background", label: "Background" },
  { key: "text", label: "Text" },
  { key: "muted", label: "Muted" },
];

function SectionCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5">
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="font-display text-[15px] font-semibold text-foreground">
        {label}
      </span>
    </label>
  );
}

export function ImportReview({
  brandId,
  brandName,
  currentVoice,
  currentPositioning,
  currentVisual,
  existingProducts,
  proposal,
  onDone,
}: ImportReviewProps) {
  const p = proposal;

  // Section include toggles: on when the proposal found something.
  const [useVoice, setUseVoice] = useState(!!p.voice_profile);
  const [usePositioning, setUsePositioning] = useState(!!p.positioning);
  const [useVisual, setUseVisual] = useState(!!p.visual_identity);

  // Editable proposal state.
  const [voice, setVoice] = useState(p.voice_profile?.voice ?? "");
  const [tone, setTone] = useState(p.voice_profile?.tone ?? "");
  const [exampleLines, setExampleLines] = useState(
    p.voice_profile?.example_posts ?? [],
  );
  const [bannedTerms, setBannedTerms] = useState(
    p.voice_profile?.banned_terms ?? [],
  );

  const [description, setDescription] = useState(
    p.positioning?.business_description ?? "",
  );
  const [tagline, setTagline] = useState(p.positioning?.tagline ?? "");
  const [differentiators, setDifferentiators] = useState(
    p.positioning?.differentiators ?? [],
  );
  const [competitors, setCompetitors] = useState(
    p.positioning?.competitors ?? [],
  );

  const [products, setProducts] = useState<
    (ProposedProduct & { include: boolean })[]
  >((p.products ?? []).map((prod) => ({ ...prod, include: true })));

  const [colors, setColors] = useState<BrandColors>(
    p.visual_identity?.colors ?? {},
  );
  const [fonts, setFonts] = useState<BrandFonts>(p.visual_identity?.fonts ?? {});
  const [logoUrl, setLogoUrl] = useState(p.visual_identity?.logo_url ?? "");
  const [contactEmail, setContactEmail] = useState(
    p.visual_identity?.footer?.contact_email ?? "",
  );

  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const includedProducts = products.filter((prod) => prod.include);
  const nothingSelected =
    !useVoice && !usePositioning && !useVisual && includedProducts.length === 0;

  async function handleSave() {
    setSaving(true);
    const saved: string[] = [];
    try {
      if (useVoice) {
        const res = await fetch("/api/settings/brand-voice", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brandId,
            // Merge over stored voice so cta_library / channel-tagged examples survive.
            voiceProfile: {
              ...currentVoice,
              ...(voice.trim() && { voice: voice.trim() }),
              ...(tone.trim() && { tone: tone.trim() }),
              ...(exampleLines.filter(Boolean).length && {
                example_posts: exampleLines.filter(Boolean),
              }),
              ...(bannedTerms.filter(Boolean).length && {
                banned_terms: [
                  ...new Set([
                    ...(currentVoice.banned_terms ?? []),
                    ...bannedTerms.filter(Boolean),
                  ]),
                ],
              }),
            } satisfies VoiceProfile,
          }),
        });
        if (!res.ok) throw new Error("Couldn't save voice.");
        saved.push("voice");
      }

      if (usePositioning) {
        const res = await fetch("/api/settings/positioning", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brandId,
            positioning: {
              ...currentPositioning,
              ...(description.trim() && {
                business_description: description.trim(),
              }),
              ...(tagline.trim() && { tagline: tagline.trim() }),
              ...(differentiators.filter(Boolean).length && {
                differentiators: differentiators.filter(Boolean),
              }),
              ...(competitors.filter(Boolean).length && {
                competitors: competitors.filter(Boolean),
              }),
            } satisfies Positioning,
          }),
        });
        if (!res.ok) throw new Error("Couldn't save positioning.");
        saved.push("positioning");
      }

      for (const prod of includedProducts) {
        const res = await fetch("/api/settings/products", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brandId,
            product: {
              slug: prod.slug,
              name: prod.name,
              description: prod.description,
              deliverables: prod.deliverables ?? [],
              price_point: prod.price_point,
              url: prod.url,
            },
          }),
        });
        if (!res.ok) throw new Error(`Couldn't save product "${prod.name}".`);
      }
      if (includedProducts.length) saved.push("products");

      if (useVisual) {
        const mergedColors = { ...currentVisual.colors };
        for (const { key } of COLOR_FIELDS) {
          const v = colors[key]?.trim();
          if (v) mergedColors[key] = v;
        }
        const visualIdentity: VisualIdentity = {
          ...currentVisual,
          ...(logoUrl.trim() && {
            logo_url: logoUrl.trim(),
            logo_alt: currentVisual.logo_alt ?? brandName,
          }),
          colors: mergedColors,
          fonts: {
            ...currentVisual.fonts,
            ...(fonts.heading?.trim() && { heading: fonts.heading.trim() }),
            ...(fonts.body?.trim() && { body: fonts.body.trim() }),
          },
          footer: {
            ...currentVisual.footer,
            ...(contactEmail.trim() && { contact_email: contactEmail.trim() }),
            ...(p.visual_identity?.footer?.website && {
              website:
                currentVisual.footer?.website ??
                p.visual_identity.footer.website,
            }),
            social: {
              ...p.visual_identity?.footer?.social,
              ...currentVisual.footer?.social, // stored links win over scraped
            },
          },
        };
        const res = await fetch("/api/settings/visual-identity", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brandId, visualIdentity }),
        });
        if (!res.ok) throw new Error("Couldn't save visual identity.");
        saved.push("visual");
      }

      toast.success("Saved.");
      onDone(saved);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">
        {p.source_url
          ? `Read ${p.pages_scraped?.length ?? 0} ${
              (p.pages_scraped?.length ?? 0) === 1 ? "page" : "pages"
            } from ${p.source_url.replace(/^https?:\/\//, "")}. `
          : ""}
        Review and edit what it found. Nothing is saved until you hit Save.
      </p>

      {p.voice_profile && (
        <Card className="space-y-4 p-5">
          <SectionCheckbox checked={useVoice} onChange={setUseVoice} label="Voice" />
          {useVoice && (
            <>
              <Field label="Voice">
                <Textarea
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  rows={3}
                />
              </Field>
              <Field label="Tone">
                <Textarea
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  rows={2}
                />
              </Field>
              <ListInput
                label="Example lines (verbatim from the site)"
                values={exampleLines}
                onChange={setExampleLines}
                multiline
              />
              {bannedTerms.length > 0 && (
                <ListInput
                  label="Banned terms"
                  values={bannedTerms}
                  onChange={setBannedTerms}
                />
              )}
            </>
          )}
        </Card>
      )}

      {p.positioning && (
        <Card className="space-y-4 p-5">
          <SectionCheckbox
            checked={usePositioning}
            onChange={setUsePositioning}
            label="Positioning"
          />
          {usePositioning && (
            <>
              <Field label="What the business does">
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </Field>
              <Field label="Tagline">
                <Input value={tagline} onChange={(e) => setTagline(e.target.value)} />
              </Field>
              <ListInput
                label="Differentiators"
                values={differentiators}
                onChange={setDifferentiators}
              />
              {competitors.length > 0 && (
                <ListInput
                  label="Competitors"
                  values={competitors}
                  onChange={setCompetitors}
                />
              )}
            </>
          )}
        </Card>
      )}

      {p.audience_summary && (
        <Card className="p-5">
          <Label>Audience (for reference)</Label>
          <p className="mt-1 text-sm text-muted">{p.audience_summary}</p>
        </Card>
      )}

      {products.length > 0 && (
        <Card className="space-y-4 p-5">
          <div className="font-display text-[15px] font-semibold text-foreground">
            Products &amp; services
          </div>
          {products.map((prod, i) => {
            const exists = existingProducts.some((e) => e.slug === prod.slug);
            return (
              <div
                key={prod.slug}
                className="space-y-3 rounded-[var(--radius-md)] border border-border p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <SectionCheckbox
                    checked={prod.include}
                    onChange={(v) =>
                      setProducts(
                        products.map((x, xi) =>
                          xi === i ? { ...x, include: v } : x,
                        ),
                      )
                    }
                    label={prod.name}
                  />
                  {exists && (
                    <span className="shrink-0 text-xs text-muted">
                      will update existing
                    </span>
                  )}
                </div>
                {prod.include && (
                  <>
                    <Field label="Name">
                      <Input
                        value={prod.name}
                        onChange={(e) =>
                          setProducts(
                            products.map((x, xi) =>
                              xi === i ? { ...x, name: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="Description">
                      <Textarea
                        value={prod.description ?? ""}
                        rows={2}
                        onChange={(e) =>
                          setProducts(
                            products.map((x, xi) =>
                              xi === i
                                ? { ...x, description: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label="Price point">
                        <Input
                          value={prod.price_point ?? ""}
                          placeholder="Only if the site states it"
                          onChange={(e) =>
                            setProducts(
                              products.map((x, xi) =>
                                xi === i
                                  ? { ...x, price_point: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field label="Link">
                        <Input
                          value={prod.url ?? ""}
                          onChange={(e) =>
                            setProducts(
                              products.map((x, xi) =>
                                xi === i ? { ...x, url: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </Field>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {p.visual_identity && (
        <Card className="space-y-4 p-5">
          <SectionCheckbox
            checked={useVisual}
            onChange={setUseVisual}
            label="Visual identity"
          />
          {useVisual && (
            <>
              {logoUrl && (
                <div className="flex items-center gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoUrl}
                    alt="Imported logo"
                    className="h-14 max-w-[180px] rounded-[var(--radius-md)] border border-border bg-background object-contain p-1"
                  />
                  <button
                    type="button"
                    onClick={() => setLogoUrl("")}
                    className="text-xs text-muted transition-colors hover:text-danger"
                  >
                    Don&apos;t use this logo
                  </button>
                </div>
              )}
              <div>
                <Label>Colors found on the site</Label>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {COLOR_FIELDS.map(({ key, label }) => (
                    <div key={key}>
                      <span className="text-xs text-muted">{label}</span>
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)] border border-border"
                          style={{ backgroundColor: colors[key] ?? "transparent" }}
                        />
                        <Input
                          value={colors[key] ?? ""}
                          onChange={(e) =>
                            setColors({ ...colors, [key]: e.target.value })
                          }
                          placeholder="(not found)"
                          className="font-mono text-[13px]"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Heading font">
                  <Input
                    value={fonts.heading ?? ""}
                    onChange={(e) =>
                      setFonts({ ...fonts, heading: e.target.value })
                    }
                    className="font-mono text-[13px]"
                  />
                </Field>
                <Field label="Body font">
                  <Input
                    value={fonts.body ?? ""}
                    onChange={(e) => setFonts({ ...fonts, body: e.target.value })}
                    className="font-mono text-[13px]"
                  />
                </Field>
              </div>
              <Field label="Contact email">
                <Input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
              </Field>
            </>
          )}
        </Card>
      )}

      <div className="flex items-center gap-3 pt-1">
        <Button
          variant="gradient"
          loading={saving}
          disabled={nothingSelected}
          onClick={handleSave}
        >
          Save selected to profile
        </Button>
        <Button variant="subtle" disabled={saving} onClick={() => onDone([])}>
          Discard
        </Button>
      </div>
    </div>
  );
}
