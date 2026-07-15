import type { ToastHandle } from "@/components/ui";

/**
 * Shape every metered route's failure body can carry (see
 * lib/ai-guard.ts's GuardResult / checkCredits). `outOfCredits` distinguishes
 * "you're out of credits, go buy more" from every other error, which the UI
 * treats very differently: a CTA instead of a plain retry message.
 */
export interface ApiErrorBody {
  error?: string;
  outOfCredits?: boolean;
  upgradeUrl?: string;
}

/**
 * An Error that carries the credit-guard fields through a throw/catch, for
 * call sites that already `throw new Error(data.error)` on a failed fetch
 * and centralize handling in one `catch`. `new ApiError(data.error, data)`
 * in the try, `toastApiError(toast, e instanceof ApiError ? e : null,
 * fallback)` in the catch.
 */
export class ApiError extends Error implements ApiErrorBody {
  outOfCredits?: boolean;
  upgradeUrl?: string;

  constructor(message: string, body?: ApiErrorBody) {
    super(message);
    this.name = "ApiError";
    this.outOfCredits = body?.outOfCredits;
    this.upgradeUrl = body?.upgradeUrl;
  }

  get error(): string {
    return this.message;
  }
}

/**
 * The one place every metered client fetch's error branch should call. Out of
 * credits gets a toast that doesn't auto-dismiss quickly and carries a Buy
 * credits link (to `upgradeUrl`, or /billing as a default); anything else
 * falls back to a normal error toast with `fallback` if the server sent no
 * message.
 */
export function toastApiError(
  toast: ToastHandle,
  body: ApiErrorBody | null | undefined,
  fallback: string,
): void {
  if (body?.outOfCredits) {
    toast.error(body.error ?? "You're out of credits. Top up to keep generating.", 8000, {
      label: "Buy credits",
      href: body.upgradeUrl ?? "/billing",
    });
    return;
  }
  toast.error(body?.error ?? fallback);
}
