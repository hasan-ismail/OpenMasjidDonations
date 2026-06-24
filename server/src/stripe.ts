/** Stripe helpers. The SECRET key lives only here and in the store — it is never
 *  returned to the browser or logged. The publishable key is the only key the
 *  browser ever sees. The Stripe API version is pinned by the SDK version in
 *  package.json (we don't pass apiVersion, so it can't silently drift). */
import Stripe from 'stripe';
import type { StripeConfig } from './store';

export type StripeMode = 'test' | 'live' | 'unknown';

const PK_RE = /^pk_(test|live)_[A-Za-z0-9]+$/;
const SK_RE = /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/;
const WHSEC_RE = /^whsec_[A-Za-z0-9]+$/;

export function looksLikePublishable(k: string): boolean {
  return PK_RE.test(k);
}
export function looksLikeSecret(k: string): boolean {
  return SK_RE.test(k);
}
export function looksLikeWebhookSecret(k: string): boolean {
  return WHSEC_RE.test(k);
}

/** Test vs live, inferred from the key prefixes (no network call). */
export function stripeMode(cfg: Pick<StripeConfig, 'publishableKey' | 'secretKey'>): StripeMode {
  const k = cfg.secretKey || cfg.publishableKey;
  if (/^[a-z]+_test_/.test(k)) return 'test';
  if (/^[a-z]+_live_/.test(k)) return 'live';
  return 'unknown';
}

/** Configured = a valid-looking publishable + secret pair, in the SAME mode. */
export function stripeConfigured(cfg: StripeConfig): boolean {
  if (!looksLikePublishable(cfg.publishableKey) || !looksLikeSecret(cfg.secretKey)) return false;
  const pkMode = cfg.publishableKey.split('_')[1];
  const skMode = cfg.secretKey.split('_')[1];
  return pkMode === skMode; // both test or both live
}

/** The non-secret view of the Stripe config, safe to send to the browser. */
export function publicStripeStatus(cfg: StripeConfig) {
  return {
    publishableKey: cfg.publishableKey, // safe — the browser needs this
    hasSecretKey: !!cfg.secretKey,
    hasWebhookSecret: !!cfg.webhookSecret,
    mode: stripeMode(cfg),
    configured: stripeConfigured(cfg),
    keysMismatch: !!cfg.publishableKey && !!cfg.secretKey && looksLikePublishable(cfg.publishableKey) && looksLikeSecret(cfg.secretKey) && cfg.publishableKey.split('_')[1] !== cfg.secretKey.split('_')[1],
  };
}

/** Ask Stripe to confirm the secret key actually works (a cheap balance.retrieve).
 *  Returns a friendly result; never throws. */
export async function verifySecretKey(secretKey: string): Promise<{ ok: boolean; mode?: StripeMode; message?: string }> {
  if (!looksLikeSecret(secretKey)) {
    return { ok: false, message: 'That doesn’t look like a Stripe secret key — it should start with sk_.' };
  }
  try {
    const stripe = new Stripe(secretKey);
    const balance = await stripe.balance.retrieve();
    return { ok: true, mode: balance.livemode ? 'live' : 'test' };
  } catch (err) {
    const e = err as { type?: string };
    if (e.type === 'StripeAuthenticationError') {
      return { ok: false, message: 'Stripe didn’t accept that secret key. Check you copied the whole key.' };
    }
    return { ok: false, message: 'Couldn’t reach Stripe to check the key. Check your connection and try again.' };
  }
}
