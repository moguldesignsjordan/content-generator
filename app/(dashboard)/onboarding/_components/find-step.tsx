"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";
import type { OnboardingInput } from "@/lib/db/types";
import { StickyAction } from "./sticky-action";

/**
 * Step 1: one box, the website. "No website?" swaps in name, one sentence
 * about what they do, and city. A failed research run comes back here
 * prefilled, with the error.
 */
export function FindStep({
  initial,
  error,
  busy,
  onSubmit,
}: {
  initial?: OnboardingInput;
  error?: string | null;
  busy: boolean;
  onSubmit: (input: OnboardingInput) => void;
}) {
  const [noSite, setNoSite] = useState(Boolean(initial && !initial.url && initial.name));
  const [url, setUrl] = useState(initial?.url ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [city, setCity] = useState(initial?.city ?? "");

  const ready = noSite ? name.trim() && description.trim() : url.trim().length >= 4;

  function submit() {
    if (!ready || busy) return;
    onSubmit(
      noSite
        ? { name: name.trim(), description: description.trim(), city: city.trim() || undefined }
        : { url: url.trim() },
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <Card className="p-5 sm:p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-4"
        >
          {noSite ? (
            <>
              <Field label="Business name">
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Acme Roofing"
                  autoComplete="organization"
                />
              </Field>
              <Field label="What you do, in one sentence">
                <Textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. We repair and replace roofs for homeowners."
                />
              </Field>
              <Field label="City (optional)" hint="Helps us find your reviews and listings.">
                <Input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Dallas, TX"
                  autoComplete="address-level2"
                />
              </Field>
            </>
          ) : (
            <Field
              label="Your website"
              hint="We'll read it and look up your reviews, then you confirm what we found."
            >
              <Input
                autoFocus
                inputMode="url"
                autoComplete="url"
                autoCapitalize="none"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="yourbusiness.com"
              />
            </Field>
          )}

          <button
            type="button"
            onClick={() => setNoSite((v) => !v)}
            className="text-[13px] font-medium text-accent hover:underline"
          >
            {noSite ? "I have a website" : "No website?"}
          </button>

          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
        </form>
      </Card>

      <StickyAction hint="About two minutes, mostly taps.">
        <Button variant="gradient" loading={busy} disabled={!ready} onClick={submit}>
          {error ? "Try again" : "Find my business"}
        </Button>
      </StickyAction>
    </motion.div>
  );
}
