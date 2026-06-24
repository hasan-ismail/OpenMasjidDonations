/** Entry point: a Fastify server that serves the built web app (donor site +
 *  admin) and the JSON API. Slice 1 established the themed shell + health check;
 *  slice 2 adds the OpenMasjidOS Fabric — single sign-on (server→server) with a
 *  local admin-password fallback, plus the notifications relay. Stripe, appeals and
 *  the donations log arrive in later slices. */
import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import { z } from 'zod';
import { config, ssoConfigured } from './config';
import { makeLog } from './logger';
import { Store } from './store';
import { COOKIE, cookieOptions, hashPassword, makeToken, verifyPassword, verifyToken, SSO_SESSION_MS } from './auth';
import { notify, platformUser } from './fabric';
import { LoginLimiter } from './rateLimit';

const log = makeLog('main');

const LOOPBACK_RE = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[?::1)/i;

async function main(): Promise<void> {
  const store = new Store();
  const loginLimiter = new LoginLimiter();

  const app = Fastify({
    logger: false, // we log ourselves and never log secrets
    // trustProxy stays OFF: the app is port-mapped directly (no reverse proxy in
    // front), so a client-supplied X-Forwarded-For must NOT be trusted — otherwise
    // the login rate-limiter could be bypassed by spoofing it. We key the limiter on
    // the real TCP peer below. (A future reverse-proxy deployment would set this to
    // the specific trusted proxy CIDR, not `true`.)
    bodyLimit: 1_048_576, // 1 MiB JSON cap (uploads get their own limit later)
  });
  await app.register(fastifyCookie); // parses req.cookies + decorates reply.setCookie

  // A request is authenticated if it carries a valid local session cookie. That
  // cookie is minted by first-run setup, by password login, or by a confirmed
  // OpenMasjidOS SSO check (see GET /api/session) — so every protected route stays a
  // simple, synchronous check.
  const isAuthed = (cookie: string | undefined): boolean => verifyToken(store.secret, cookie, 'admin');

  const requireAdmin = async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    if (!isAuthed(req.cookies[COOKIE])) {
      return reply.code(401).send({ error: 'Please sign in.' });
    }
  };

  // ── Health check ────────────────────────────────────────────────────────────
  app.get('/healthz', async () => ({ ok: true }));

  // ── Public bootstrap the web app reads on load (no secrets) ─────────────────
  app.get('/api/app', async () => ({
    data: {
      name: 'OpenMasjid Donations',
      version: config.version,
      embedded: ssoConfigured(),
      omosBase: config.omosBaseUrl, // '' when standalone
    },
  }));

  // ── Session: who am I? Also performs the SSO upgrade. ───────────────────────
  // If not already signed in here but the visitor carries a valid OpenMasjidOS
  // session, we confirm it with the platform (server→server) and mint a short-lived
  // local cookie, so the rest of the API stays a simple synchronous check. Falls
  // back silently to local login when SSO is absent or the platform is down.
  app.get('/api/session', async (req, reply) => {
    let authed = isAuthed(req.cookies[COOKIE]);
    let username: string | undefined;
    if (!authed && ssoConfigured()) {
      const user = await platformUser(req.headers.cookie);
      if (user) {
        reply.setCookie(COOKIE, makeToken(store.secret, SSO_SESSION_MS), cookieOptions(SSO_SESSION_MS));
        authed = true;
        username = user;
      }
    }
    return {
      data: {
        // Standalone: first run creates a password. Under OpenMasjidOS, signing in
        // is the dashboard's job (SSO), so we never block on local setup.
        needsSetup: !store.hasAdmin() && !ssoConfigured(),
        authed,
        hasPassword: store.hasAdmin(),
        sso: { enabled: ssoConfigured(), username },
      },
    };
  });

  // ── First-run setup (standalone only) ───────────────────────────────────────
  const SetupBody = z.object({ password: z.string().min(8).max(200), name: z.string().max(80).optional() });
  app.post('/api/setup', async (req, reply) => {
    // Under OpenMasjidOS, sign-in is the dashboard's job (SSO) — there is no local
    // admin password to claim, so refuse setup to close the pre-setup window.
    if (ssoConfigured()) return reply.code(403).send({ error: 'This panel signs in through OpenMasjidOS.' });
    if (store.hasAdmin()) return reply.code(409).send({ error: 'This app is already set up.' });
    const parsed = SetupBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Please choose a password of at least 8 characters.' });
    store.setAdmin(hashPassword(parsed.data.password), parsed.data.name?.trim());
    reply.setCookie(COOKIE, makeToken(store.secret), cookieOptions());
    return { data: { ok: true } };
  });

  // ── Password login (rate-limited) ───────────────────────────────────────────
  const LoginBody = z.object({ password: z.string().min(1).max(200) });
  app.post('/api/login', async (req, reply) => {
    // Key the brute-force limiter on the real, unspoofable TCP peer — never req.ip
    // (which would honour a forged X-Forwarded-For). This is the defence behind the
    // short admin password, so it must not be bypassable by a request header.
    const peer = req.socket.remoteAddress ?? 'unknown';
    const wait = loginLimiter.retryAfterMs(peer);
    if (wait > 0) return reply.code(429).send({ error: `Too many attempts. Try again in ${Math.ceil(wait / 1000)}s.` });
    const admin = store.getAdmin();
    if (!admin) return reply.code(400).send({ error: 'This app has not been set up yet.' });
    const parsed = LoginBody.safeParse(req.body);
    if (parsed.success && verifyPassword(parsed.data.password, admin)) {
      loginLimiter.succeed(peer);
      reply.setCookie(COOKIE, makeToken(store.secret), cookieOptions());
      return { data: { ok: true } };
    }
    loginLimiter.fail(peer);
    return reply.code(401).send({ error: 'Incorrect password.' });
  });

  app.post('/api/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { data: { ok: true } };
  });

  // ── Fabric notifications: diagnose + send a test alert ──────────────────────
  // Reports what the platform injected (non-secret) so the admin can see exactly why
  // alerts are/aren't arriving, and fires a real test through the Fabric. Donation
  // events in later slices relay through the same notify() helper.
  app.post('/api/admin/notify-test', { preHandler: requireAdmin }, async () => {
    const base = config.omosBaseUrl;
    const hasSecret = !!config.omosAppSecret;
    let result: { delivered: boolean; reason?: string } = { delivered: false, reason: 'no-fabric' };
    if (base && hasSecret) {
      result = await notify({
        title: 'OpenMasjid Donations — test',
        text: '✅ Test alert from OpenMasjid Donations. If you see this, donation alerts will reach you here.',
        level: 'info',
      });
    }
    return {
      data: { baseUrlSet: !!base, hasSecret, baseUrlLoopback: LOOPBACK_RE.test(base), appId: config.omosAppId, ...result },
    };
  });

  // ── Static web app (built by Vite into ./public) ────────────────────────────
  const havePublic = fs.existsSync(path.join(config.publicDir, 'index.html'));
  if (havePublic) {
    await app.register(fastifyStatic, { root: config.publicDir, index: ['index.html'] });
  } else {
    log.warn(`no built web app at ${config.publicDir} — run "cd web && npm run build" (dev uses the Vite server)`);
  }

  // SPA fallback: client-side routes (e.g. /admin) resolve to index.html; requests
  // that look like a file (have an extension, e.g. a stale /assets/x.js) still 404
  // rather than silently returning the app shell; unknown API routes return JSON.
  app.setNotFoundHandler((req, reply) => {
    const url = req.raw.url ?? '/';
    const pathname = url.split('?')[0];
    const looksLikeFile = path.extname(pathname) !== '';
    if (req.method === 'GET' && havePublic && !looksLikeFile && !url.startsWith('/api') && !url.startsWith('/healthz')) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found.' });
  });

  // Consistent JSON error envelope; never leak a stack trace OR framework-internal
  // text to the browser. Only a message the app itself authored (expose: true) is
  // surfaced; everything else becomes a friendly line.
  app.setErrorHandler((err, _req, reply) => {
    const e = err as { message?: string; statusCode?: number; expose?: boolean };
    log.error('request error', e.message ?? 'unknown');
    const status = typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
    const friendly =
      status === 413 ? 'That request was too large.' : status < 500 ? "We couldn't process that request." : 'Something went wrong. Please try again.';
    reply.code(status).send({ error: e.expose && e.message ? e.message : friendly });
  });

  await app.listen({ port: config.port, host: config.host });
  log.info(`OpenMasjid Donations listening on http://${config.host}:${config.port}`);
  log.info(ssoConfigured() ? 'running embedded under OpenMasjidOS (Fabric available)' : 'running standalone (local password)');

  const shutdown = () => {
    log.info('shutting down');
    store.close();
    app.close().finally(() => setTimeout(() => process.exit(0), 200));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  // Log the message only (not the whole error object) so a future thrown error
  // can't spill a key or connection string into the logs.
  log.error('fatal startup error', err instanceof Error ? err.message : err);
  process.exit(1);
});
