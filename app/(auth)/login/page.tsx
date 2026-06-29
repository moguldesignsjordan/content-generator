import { Suspense } from "react";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { Card, Logo } from "@/components/ui";
import { LoginCard } from "./login-card";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  if (!isSupabaseAuthConfigured()) {
    return (
      <main className="relative flex min-h-dvh items-center justify-center px-5 py-10">
        <Glow />
        <Card className="relative z-10 w-full max-w-md p-7">
          <Logo height={40} className="mb-5" />
          <h1 className="font-display text-xl font-semibold">Connect Supabase</h1>
          <p className="mt-1.5 text-sm text-muted">
            Sign-in needs a Supabase project. Once it's connected, this screen
            becomes your login.
          </p>
          <ol className="mt-5 space-y-2.5 text-sm text-muted">
            {[
              "Create a Supabase project (Project Settings, API).",
              "Paste the project URL and anon key into .env.local.",
              "Make sure Email auth is enabled (Auth, Providers).",
              "Reload this page to sign in.",
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-accent">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </Card>
      </main>
    );
  }

  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Glow />
      <div className="relative z-10 mx-auto flex min-h-dvh max-w-5xl flex-col items-center justify-center gap-10 px-5 py-10 md:flex-row md:gap-16">
        {/* Hero */}
        <div className="flex-1 text-center md:text-left">
          <Logo height={48} className="mx-auto md:mx-0" />
          <h1 className="mt-6 font-display text-[34px] font-semibold leading-[1.05] tracking-tight md:text-[44px]">
            On-brand content,
            <br />
            <span className="text-muted">shipped on your terms.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted md:mx-0">
            Mogul turns your brand strategy into emails and posts you actually
            approve. Sign in to pick up where you left off.
          </p>
        </div>

        {/* Auth card */}
        <div className="w-full max-w-sm">
          <Card className="p-6 sm:p-7">
            <Suspense
              fallback={
                <div className="flex h-64 items-center justify-center text-sm text-muted">
                  Loading…
                </div>
              }
            >
              <LoginCard />
            </Suspense>
          </Card>
        </div>
      </div>
    </main>
  );
}

function Glow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -top-48 left-1/2 h-[520px] w-[760px] -translate-x-1/2 rounded-full bg-spectrum opacity-[0.16] blur-[130px]"
    />
  );
}
