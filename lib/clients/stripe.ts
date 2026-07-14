import "server-only";
import Stripe from "stripe";

// ─────────────────────────────────────────────────────────────────────────────
// Server-only Stripe client, mirroring lib/clients/anthropic.ts: `server-only`
// keeps the secret key out of any client bundle, read once from the
// environment, lazily instantiated so a dev environment with no Stripe keys
// yet doesn't crash on import (isStripeConfigured lets routes degrade
// gracefully instead of throwing).
// ─────────────────────────────────────────────────────────────────────────────

const secretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export function isStripeConfigured(): boolean {
  return Boolean(secretKey);
}

export function isStripeWebhookConfigured(): boolean {
  return Boolean(webhookSecret);
}

export function getStripeWebhookSecret(): string {
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set in .env.local.");
  }
  return webhookSecret;
}

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set in .env.local.");
  }
  if (!client) {
    client = new Stripe(secretKey);
  }
  return client;
}
