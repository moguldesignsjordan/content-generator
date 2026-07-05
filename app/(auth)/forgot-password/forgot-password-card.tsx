"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Field, Input, useToast } from "@/components/ui";

export function ForgotPasswordCard() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Enter your email first.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the reset link.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-accent">
            <path d="M2 7l10 7 10-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="2" y="5" width="20" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </div>
        <h2 className="font-display text-lg font-semibold">Check your email</h2>
        <p className="mt-1.5 text-sm text-muted">
          We sent a password reset link to <span className="text-foreground">{email}</span>.
        </p>
        <button
          type="button"
          onClick={() => router.push("/login")}
          className="mt-5 text-sm font-medium text-accent hover:text-accent-press"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-lg font-semibold">Reset your password</h1>
      <p className="mt-1.5 text-sm text-muted">
        Enter your email and we'll send you a link to set a new password.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@brand.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Button type="submit" variant="gradient" size="lg" loading={loading} className="w-full">
          Send reset link
        </Button>
      </form>

      <p className="mt-5 text-center text-[12px] text-muted-2">
        <button
          type="button"
          onClick={() => router.push("/login")}
          className="font-medium text-accent hover:text-accent-press"
        >
          Back to sign in
        </button>
      </p>
    </div>
  );
}
