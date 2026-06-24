/** Typed client for the OpenMasjid Donations API. Responses use a { data | error }
 *  envelope; this unwraps `data` and turns `error` into a thrown friendly message. */

export interface AppInfo {
  name: string;
  version: string;
  /** True when running embedded under OpenMasjidOS (Fabric available). */
  embedded: boolean;
  /** Platform base URL for live appearance sync; '' when standalone. */
  omosBase: string;
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
