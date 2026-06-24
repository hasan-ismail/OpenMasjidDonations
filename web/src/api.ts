/** Typed client for the OpenMasjid Donations API. Responses use a { data | error }
 *  envelope; this unwraps `data` and turns `error` into a thrown friendly message. */

export interface AppInfo {
  name: string;
  version: string;
  /** True when running embedded under OpenMasjidOS (Fabric available). */
  embedded: boolean;
  /** Platform base URL for live appearance sync; '' when standalone. */
  omosBase: string;
  /** Whether a valid Stripe publishable+secret pair is configured. */
  donationsConfigured: boolean;
  /** Whether the admin has completed first-run setup. */
  onboarded: boolean;
}

export interface Session {
  /** Standalone first-run: no admin password set yet (and not under SSO). */
  needsSetup: boolean;
  /** Signed in (via local password or a confirmed OpenMasjidOS SSO session). */
  authed: boolean;
  /** A local admin password exists. */
  hasPassword: boolean;
  sso: { enabled: boolean; username?: string };
}

export interface NotifyTestResult {
  baseUrlSet: boolean;
  hasSecret: boolean;
  baseUrlLoopback: boolean;
  appId: string;
  delivered: boolean;
  reason?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!res.ok || body.error) {
    throw new Error(body.error || 'Something went wrong. Please try again.');
  }
  return body.data as T;
}

export const getAppInfo = () => request<AppInfo>('/api/app');
export const getSession = () => request<Session>('/api/session');

export const setupAdmin = (password: string, name?: string) =>
  request<{ ok: true }>('/api/setup', { method: 'POST', body: JSON.stringify({ password, name }) });

export const login = (password: string) =>
  request<{ ok: true }>('/api/login', { method: 'POST', body: JSON.stringify({ password }) });

export const logout = () => request<{ ok: true }>('/api/logout', { method: 'POST' });

export const sendTestNotification = () =>
  request<NotifyTestResult>('/api/admin/notify-test', { method: 'POST' });

// ── Settings (masjid details + Stripe config + onboarding) ──────────────────

export interface MasjidProfile {
  name: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  currency: string;
}

export type StripeMode = 'test' | 'live' | 'unknown';

/** The non-secret view of the Stripe config (the only thing the server returns). */
export interface StripeStatus {
  publishableKey: string;
  hasSecretKey: boolean;
  hasWebhookSecret: boolean;
  mode: StripeMode;
  configured: boolean;
  keysMismatch: boolean;
}

export interface Settings {
  masjid: MasjidProfile;
  stripe: StripeStatus;
  onboarded: boolean;
}

export interface VerifyResult {
  ok: boolean;
  mode?: StripeMode;
  message?: string;
}

export type SaveStripeResult = StripeStatus & { verify?: VerifyResult };

export const getSettings = () => request<Settings>('/api/settings');

export const saveMasjid = (patch: Partial<MasjidProfile>) =>
  request<MasjidProfile>('/api/settings/masjid', { method: 'PUT', body: JSON.stringify(patch) });

/** Only send the secret/webhook keys when the admin actually typed one (omit to
 *  keep the saved value; '' to clear). The secret key is never returned. */
export const saveStripe = (patch: { publishableKey?: string; secretKey?: string; webhookSecret?: string }) =>
  request<SaveStripeResult>('/api/settings/stripe', { method: 'PUT', body: JSON.stringify(patch) });

export const completeOnboarding = () =>
  request<{ ok: true }>('/api/settings/complete-onboarding', { method: 'POST' });

export const testStripe = () => request<VerifyResult>('/api/admin/stripe-test', { method: 'POST' });
