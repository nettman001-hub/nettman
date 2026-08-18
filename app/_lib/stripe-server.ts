import Stripe from "stripe";

let stripeClient: Stripe | null = null;
let stripeSecret: string | null = null;

export function stripeCheckoutConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

export function stripeWebhookConfigured(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim());
}

export function getStripeClient(): Stripe | null {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) return null;
  if (!stripeClient || stripeSecret !== secret) {
    stripeClient = new Stripe(secret, {
      httpClient: Stripe.createFetchHttpClient(),
    });
    stripeSecret = secret;
  }
  return stripeClient;
}

export function getStripeWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
}

export { Stripe };
