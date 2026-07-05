"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Field, Input, SegmentedControl, useToast } from "@/components/ui";

type Mode = "signin" | "signup";

export function LoginCard() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("redirect") || "/";

  const supabase = createClient();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState<"pw" | "magic" | null>(null);
  const [magicSent, setMagicSent] = useState(false);
  const toast = useToast();

  function finish() {
    router.refresh();
    router.push(redirectTo);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("Enter your email and password.");
      return;
    }
    setLoading("pw");
    try {
      const { error } =
        mode === "signin"
          ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
          : await supabase.auth.signUp({ email: email.trim(), password });
      if (error) throw error;

      if (mode === "signup") {
        // signUp may return a session immediately (if confirmations off) or
        // require email confirmation. Try to read the session.
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          finish();
          return;
        }
        setMagicSent(true);
        setLoading(null);
        return;
      }
      finish();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(null);
    }
  }

  async function handleMagic() {
    if (!email.trim()) {
      toast.error("Enter your email first.");
      return;
    }
    setLoading("magic");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setMagicSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the link.");
    } finally {
      setLoading(null);
    }
  }

  if (magicSent) {
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
          We sent a sign-in link to <span className="text-foreground">{email}</span>.
          It expires shortly.
        </p>
        <button
          type="button"
          onClick={() => {
            setMagicSent(false);
            setMode("signin");
          }}
          className="mt-5 text-sm font-medium text-accent hover:text-accent-press"
        >
          Use a password instead
        </button>
      </div>
    );
  }

  return (
    <div>
      <SegmentedControl
        className="mb-6 w-full [&>button]:flex-1"
        value={mode}
        onChange={(v) => setMode(v as Mode)}
        options={[
          { value: "signin", label: "Sign in" },
          { value: "signup", label: "Create account" },
        ]}
      />

      <form onSubmit={handleSubmit} className="space-y-4">
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
        <Field label="Password" htmlFor="password">
          <div className="relative">
            <Input
              id="password"
              type={showPw ? "text" : "password"}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              placeholder={mode === "signin" ? "Your password" : "Choose a password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-16"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-muted hover:text-foreground"
              tabIndex={-1}
            >
              {showPw ? "Hide" : "Show"}
            </button>
          </div>
        </Field>

        <Button
          type="submit"
          variant="gradient"
          size="lg"
          loading={loading === "pw"}
          className="w-full"
        >
          {mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-[12px] text-muted-2">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button
        type="button"
        variant="subtle"
        size="lg"
        loading={loading === "magic"}
        onClick={handleMagic}
        className="w-full"
      >
        Email me a sign-in link
      </Button>

      <p className="mt-5 text-center text-[12px] text-muted-2">
        {mode === "signin"
          ? "New to Mogul? Create an account to get started."
          : "Already have an account? Switch to sign in."}
      </p>
    </div>
  );
}
