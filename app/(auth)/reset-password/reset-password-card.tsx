"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Field, Input, useToast } from "@/components/ui";

export function ResetPasswordCard() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [linkState, setLinkState] = useState<"checking" | "valid" | "invalid">("checking");
  const toast = useToast();

  // A reset link only works if the callback established a recovery session.
  // If it didn't (expired link, opened in a different browser), say so
  // instead of failing with a cryptic error on submit.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setLinkState(data.user ? "valid" : "invalid");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated.");
      router.refresh();
      router.push("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update your password.");
      setLoading(false);
    }
  }

  if (linkState === "invalid") {
    return (
      <div className="text-center">
        <h2 className="font-display text-lg font-semibold">This link didn't work</h2>
        <p className="mt-1.5 text-sm text-muted">
          The reset link is invalid or has expired. Request a fresh one and open it in this browser.
        </p>
        <button
          type="button"
          onClick={() => router.push("/forgot-password")}
          className="mt-5 text-sm font-medium text-accent hover:text-accent-press"
        >
          Send a new reset link
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-lg font-semibold">Set a new password</h1>
      <p className="mt-1.5 text-sm text-muted">Choose a new password for your account.</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <Field label="New password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="Choose a password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Confirm password" htmlFor="confirm">
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            placeholder="Re-enter password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>

        <Button type="submit" variant="gradient" size="lg" loading={loading} className="w-full">
          Update password
        </Button>
      </form>
    </div>
  );
}
