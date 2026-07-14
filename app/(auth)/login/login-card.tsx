"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { signInWithPassword, type SignInState } from "@/lib/supabase/actions";
import { Button, Checkbox, Field, Input, SegmentedControl, useToast } from "@/components/ui";

type Mode = "signin" | "signup";

const REMEMBERED_EMAIL_KEY = "mogul.lastEmail";

export function LoginCard() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("redirect") || "/";
  const authError = params.get("error");

  const supabase = createClient();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState<"signup" | "magic" | null>(null);
  const [magicSent, setMagicSent] = useState(false);
  const toast = useToast();

  const [signInState, signInAction, signInPending] = useActionState<SignInState, FormData>(
    signInWithPassword,
    null,
  );

  useEffect(() => {
    const saved = window.localStorage.getItem(REMEMBERED_EMAIL_KEY);
    if (saved) setEmail(saved);
  }, []);

  useEffect(() => {
    if (signInState?.error) toast.error(signInState.error);
  }, [signInState, toast]);

  function rememberEmail() {
    const trimmed = email.trim();
    if (!trimmed) return;
    try {
      window.localStorage.setItem(REMEMBERED_EMAIL_KEY, trimmed);
    } catch {
      // Best-effort; ignore (private browsing can disable localStorage).
    }
  }

  function finish() {
    window.location.href = redirectTo;
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("Enter your email and password.");
      return;
    }
    setLoading("signup");
    try {
      const { error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) throw error;

      // signUp may return a session immediately (if confirmations off) or
      // require email confirmation. Try to read the session.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        finish();
        return;
      }
      setMagicSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
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
      {authError && (
        <div className="mb-5 rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted">
          {authError}
        </div>
      )}
      <SegmentedControl
        className="mb-6 w-full [&>button]:flex-1"
        value={mode}
        onChange={(v) => setMode(v as Mode)}
        options={[
          { value: "signin", label: "Sign in" },
          { value: "signup", label: "Create account" },
        ]}
      />

      <form
        {...(mode === "signin"
          ? { action: signInAction }
          : { onSubmit: handleSignup })}
        className="space-y-4"
      >
        {mode === "signin" && <input type="hidden" name="redirectTo" value={redirectTo} />}
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            name="email"
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
              name="password"
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

        {mode === "signin" && (
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-[12px] font-medium text-muted">
              <Checkbox name="remember" size="sm" defaultChecked />
              Remember me
            </label>
            <button
              type="button"
              onClick={() => router.push("/forgot-password")}
              className="text-[12px] font-medium text-muted hover:text-foreground"
            >
              Forgot password?
            </button>
          </div>
        )}

        <Button
          type="submit"
          variant="gradient"
          size="lg"
          loading={mode === "signin" ? signInPending : loading === "signup"}
          onClick={mode === "signin" ? rememberEmail : undefined}
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
