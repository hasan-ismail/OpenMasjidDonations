/** Environment configuration. Install settings seed first-run defaults only; all
 *  ongoing configuration will live in the data volume (a later slice). Secrets are
 *  read here but NEVER logged or sent to the browser. */
import fs from 'node:fs';
import path from 'node:path';

function env(name: string, def = ''): string {
  const v = process.env[name];
  return v == null || v === '' ? def : v;
}
function intEnv(name: string, def: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : def;
}

/** Read this app's version from the package.json shipped next to the runtime
 *  (copied to /app/package.json in the image). Falls back gracefully in dev. */
function readVersion(): string {
  for (const p of [path.join(process.cwd(), 'package.json'), path.join(__dirname, '..', 'package.json')]) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      /* try next */
    }
  }
  return '0.1.0';
}

export const config = {
  port: intEnv('PORT', 8080),
  /** Bind all interfaces so the LAN (and Docker port mapping) can reach us. */
  host: env('HOST', '0.0.0.0'),
  dataDir: env('DATA_DIR', path.resolve(process.cwd(), 'data')),
  publicDir: env('PUBLIC_DIR', path.resolve(__dirname, '..', 'public')),
  version: readVersion(),

  /** OpenMasjidOS Fabric (the platform↔app appearance + SSO layer). Injected by the
   *  platform at install and empty on a standalone install, where the app uses its
   *  own appearance + own login. The wire identifiers (env var names, header,
   *  cookie, endpoints) are the shared Fabric contract and must stay byte-for-byte.
   *  See docs/ARCHITECTURE.md. */
  omosBaseUrl: env('OPENMASJID_BASE_URL', '').replace(/\/+$/, ''),
  omosAppId: env('OPENMASJID_APP_ID', ''),
  /** Per-app secret issued by the platform to `sso: true` apps. SSO is identity-
   *  bound: we must present this on the /api/auth/session check or the platform
   *  fails closed. It is a CREDENTIAL — never log or expose it. */
  omosAppSecret: env('OPENMASJID_APP_SECRET', ''),

  /** Stripe — seeded from install settings if provided. The data volume becomes the
   *  source of truth once the admin sets/rotates keys in-app (a later slice). The
   *  SECRET key is server-side only and must never reach the browser. */
  seed: {
    stripePublishableKey: env('STRIPE_PUBLISHABLE_KEY', ''),
    stripeSecretKey: env('STRIPE_SECRET_KEY', ''),
    stripeWebhookSecret: env('STRIPE_WEBHOOK_SECRET', ''),
    currency: env('CURRENCY', '').toUpperCase(),
  },
};

/** True when the app is running embedded under OpenMasjidOS with SSO available. */
export function ssoConfigured(): boolean {
  return !!config.omosBaseUrl && !!config.omosAppSecret;
}

export type Config = typeof config;
