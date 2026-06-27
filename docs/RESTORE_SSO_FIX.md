<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 OpenMasjid-Solutions -->

# Bug: the panel locks you out after an OpenMasjidOS backup is restored / the box is migrated

> **Status: FIXED in v0.16.0.** Both fixes below are implemented. What shipped, precisely:
>
> **Fix #1 — never brick.**
> - `GET /api/session` now returns `sso: { enabled, reachable, username }`. `reachable` is
>   false only when SSO is configured but the platform couldn't be contacted
>   (`server/src/fabric.ts` `probePlatform` / `platformReachable`).
> - `POST /api/setup` no longer hard-`403`s whenever SSO is configured. The local password
>   is allowed as a recovery when SSO is **not configured** *or* the platform is **currently
>   unreachable**; it is still refused (with a friendly "sign in through OpenMasjidOS"
>   message) only when the platform **is reachable** — which both keeps the panel
>   un-brickable *and* closes the pre-setup window where a LAN passer-by could otherwise
>   claim the admin password before the real admin.
> - The web admin (`SsoGate` in `web/src/admin.tsx`) leads with a "Can't reach OpenMasjidOS
>   — Try again / Set a password to get in" recovery when `reachable` is false, instead of
>   dead-ending on "open from the dashboard".
> - `OPENMASJID_BASE_URL` / `OPENMASJID_APP_SECRET` are still read from env every start and
>   never persisted (`server/src/config.ts`).
>
> **Fix #2 — Stripe via the Fabric.** `manifest.yaml` sets `stripe: true` and adds an
> optional `STRIPE_ACCOUNT` install setting. The server fetches the vaulted keys
> server-to-server (`server/src/fabric.ts` `fetchFabricStripe`, in-memory cache only, never
> persisted), and `effectiveAccountFor` / `accountById` (`server/src/index.ts`) use the
> Fabric account when it's configured, falling back to locally-entered keys when the Fabric
> is absent or unreachable. Confirm-on-return resolves the account by the donation's
> recorded id (never re-resolves), so a config/reachability change can't strand a payment.
> The admin Payments screen shows "Connected through OpenMasjidOS" instead of asking for
> keys. Cloudflare/domain is unchanged for now (still the app's own tunnel) — see Fix #2 below.
>
> Verified by `scratchpad/verify-restore-fabric.mjs` (unreachable-platform recovery,
> reachable-platform setup refusal, SSO sign-in, Fabric-only campaign + payment readiness,
> and "the Stripe secret never reaches any client").

**Severity:** high (no way into the admin panel until fixed).
**Where:** `server/src/index.ts` — `GET /api/session` (~line 154) and `POST /api/setup` (~line 179).
**Applies to:** any OpenMasjidOS-integrated app; the same trap exists in OpenMasjid Display.

---

## Symptom

After the admin restores an OpenMasjidOS backup (especially onto a **new machine**), opening the
Donations admin shows the OpenMasjidOS sign-in screen, but SSO never completes and **"Set a password
instead"** fails with **"This panel signs in through OpenMasjidOS."** → no way in.

## Root cause

The local-password path is gated on `ssoConfigured()`:

```ts
// server/src/index.ts
needsSetup: !store.hasAdmin() && !ssoConfigured(),                  // /api/session (~169)
...
if (ssoConfigured()) return reply.code(403).send({ error: 'This panel signs in through OpenMasjidOS.' }); // /api/setup (~182)
```

`ssoConfigured() = !!omosBaseUrl && !!omosAppSecret` (platform-injected env). After a restore those
env vars are still set, so `ssoConfigured()` stays `true` — but the SSO probe
(`GET ${OPENMASJID_BASE_URL}/api/auth/session`) **fails** when the platform is unreachable (the OS
injected the **old machine's IP** after a migration, or the platform is briefly down). SSO can't
complete **and** local setup is refused → bricked.

> Platform-side migration fix shipped in **OpenMasjidOS v0.27.0** (re-resolves `OPENMASJID_BASE_URL`
> to the current machine on restore) + **v0.28.0** ("Reset sign-in" recovery). Ask the admin to update
> OpenMasjidOS — **but the app must still never brick** when the platform is momentarily unreachable.

## Fix #1 — never let the panel get bricked (do this)

1. **Allow the local-password recovery even when SSO is configured.** Drop the `if (ssoConfigured())
   return 403` in `/api/setup`; keep the `if (admin exists) 409` guard. "Set a password instead"
   then always works as the recovery; SSO remains the convenient default.
2. **Surface platform reachability** in `/api/session` (`sso: { enabled, reachable, username }`) so
   the web app can show "Can't reach OpenMasjidOS — [Retry] or [Set a password to get in]" instead of
   a dead loop.
3. **Never persist `OPENMASJID_BASE_URL` / `OPENMASJID_APP_SECRET` to the data volume** — read them
   from `process.env` every start (your `config.ts` already does; keep it). The platform changes the
   base URL across restarts/migrations, so a cached copy would re-introduce this bug.

### Verify

Run with `OPENMASJID_BASE_URL=http://10.255.255.1` (unreachable) + any `OPENMASJID_APP_SECRET` →
you must still be able to get in via **"Set a password instead."**

## Fix #2 — move Stripe (and Cloudflare) into the OS Fabric (recommended; the owner asked for this)

Donations currently stores its **own** Stripe accounts and Cloudflare-tunnel token
(`server/src/index.ts` ~line 331 Cloudflare, ~line 360 Stripe accounts). The platform now centralizes
these so the admin configures them **once in OpenMasjidOS** and every app shares them — and they're
backed up/migrated with the OS, not per-app.

**Stripe via the Fabric (available now — OpenMasjidOS v0.29.0):**

- Set `stripe: true` in `manifest.yaml` → the platform issues this app the per-app secret.
- Add an install setting like `STRIPE_ACCOUNT` (the account *name* the admin picks for this app).
- At runtime fetch the keys instead of storing them:

  ```ts
  // server→server; the per-app secret proves identity. Returns:
  //   { id, label, publishableKey, secretKey, webhookSecret }
  const res = await fetch(
    `${config.omosBaseUrl}/api/fabric/stripe?account=${encodeURIComponent(process.env.STRIPE_ACCOUNT ?? '')}`,
    { headers: { 'x-openmasjid-app-secret': config.omosAppSecret }, redirect: 'error' },
  );
  ```

  Keep your existing local Stripe fields as the **standalone fallback** (when `ssoConfigured()` is
  false). When the Fabric is present, prefer the Fabric account; don't store the fetched secret keys in
  `db.json` (fetch per process start / cache in memory only) so they always track the OS vault.

**Cloudflare/domain:** the platform is taking over the Cloudflare tunnel + domain (path-based, e.g.
`omos.xyz.org/donate`). Once that ships, the app won't need its own tunnel token — it'll just be
reachable at its assigned path. Until then your local tunnel still works; no rush to remove it, but
plan to drop it.

See the OpenMasjidAPPS contract (`docs/BUILDING_AN_APP.md` → Fabric capabilities + Restore resilience)
for the canonical spec.
