import { Card, Logo } from "@/components/ui";
import { ResetPasswordCard } from "./reset-password-card";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-5 py-10">
      <Glow />
      <div className="relative z-10 w-full max-w-sm">
        <Logo height={40} className="mb-6" />
        <Card className="p-6 sm:p-7">
          <ResetPasswordCard />
        </Card>
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
