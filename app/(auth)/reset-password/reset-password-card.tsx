"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Field, Input, useToast } from "@/components/ui";

export function ResetPasswordCard() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const toast = useToast();

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
