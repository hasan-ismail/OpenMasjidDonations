/** Durable store for all app state, kept in the data volume as a single SQLite file
 *  (better-sqlite3, WAL). Everything goes through this thin repository so a different
 *  backend (e.g. Postgres) could be slotted in later without touching the routes.
 *
 *  Slice 2 persists only the admin credential + the session-signing secret. Later
 *  slices add proper tables (Stripe config, appeals, donations) alongside these. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { config } from './config';
import { makeLog } from './logger';
import type { Cred } from './auth';

const log = makeLog('store');

/** Drop undefined values so a partial update never overwrites a field with nothing. */
function clean<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export interface Admin extends Cred {
  name?: string;
  createdAt: string;
}

/** Masjid branding/details — seeded from MASJID_* / install settings, then owned by
 *  the admin once edited in-app. Used for receipts, branding and the default
 *  donation currency. */
export interface MasjidProfile {
  name: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  currency: string;
}

/** Stripe credentials. The SECRET key + webhook secret are server-side only and
 *  must never be returned to the browser or logged. */
export interface StripeConfig {
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
}

export class Store {
  private readonly db: Database.Database;
  private cachedSecret: Buffer | null = null;

  constructor(dbPath = path.join(config.dataDir, 'donations.db')) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    // A small key/value table for singletons (admin credential, signing secret,
    // and — in later slices — Stripe config). Structured data gets its own tables.
    this.db.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    // Tighten file perms where the OS supports it (the secret + admin hash live here).
    try {
      fs.chmodSync(dbPath, 0o600);
    } catch {
      /* best-effort (e.g. Windows dev) */
    }
    log.info(`data store ready at ${dbPath}`);
  }

  private getRaw(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  private setRaw(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  /** The HMAC secret that signs session cookies. Generated once and persisted, so
   *  sessions survive restarts but are invalidated if the data volume is wiped. */
  get secret(): Buffer {
    if (this.cachedSecret) return this.cachedSecret;
    let hex = this.getRaw('session_secret');
    if (!hex) {
      hex = crypto.randomBytes(32).toString('hex');
      this.setRaw('session_secret', hex);
    }
    this.cachedSecret = Buffer.from(hex, 'hex');
    return this.cachedSecret;
  }

  getAdmin(): Admin | null {
    const raw = this.getRaw('admin');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Admin;
    } catch {
      return null;
    }
  }

  hasAdmin(): boolean {
    return this.getRaw('admin') !== null;
  }

  setAdmin(cred: Cred, name?: string): void {
    const admin: Admin = { ...cred, name: name || undefined, createdAt: new Date().toISOString() };
    this.setRaw('admin', JSON.stringify(admin));
  }

  private getJson<T>(key: string): Partial<T> {
    const raw = this.getRaw(key);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Partial<T>;
    } catch {
      return {};
    }
  }

  /** Masjid profile: stored values take precedence over the env seeds. */
  getMasjid(): MasjidProfile {
    const s = this.getJson<MasjidProfile>('masjid');
    const seed = config.seed;
    return {
      name: s.name ?? seed.masjid.name,
      address: s.address ?? seed.masjid.address,
      email: s.email ?? seed.masjid.email,
      phone: s.phone ?? seed.masjid.phone,
      website: s.website ?? seed.masjid.website,
      currency: (s.currency ?? seed.currency ?? 'GBP').toUpperCase() || 'GBP',
    };
  }

  setMasjid(patch: Partial<MasjidProfile>): MasjidProfile {
    const merged = { ...this.getMasjid(), ...clean(patch) };
    if (merged.currency) merged.currency = merged.currency.toUpperCase();
    this.setRaw('masjid', JSON.stringify(merged));
    return merged;
  }

  /** Stripe config: stored values take precedence over the env seeds. Never return
   *  the result of this to the browser — it contains the secret key. */
  getStripe(): StripeConfig {
    const s = this.getJson<StripeConfig>('stripe');
    const seed = config.seed.stripe;
    return {
      publishableKey: s.publishableKey ?? seed.publishableKey,
      secretKey: s.secretKey ?? seed.secretKey,
      webhookSecret: s.webhookSecret ?? seed.webhookSecret,
    };
  }

  /** Apply a partial update. A provided '' clears that key; an omitted key is left
   *  untouched (so the admin can update one field without resending secrets). */
  setStripe(patch: Partial<StripeConfig>): StripeConfig {
    const current = this.getStripe();
    const merged: StripeConfig = {
      publishableKey: patch.publishableKey ?? current.publishableKey,
      secretKey: patch.secretKey ?? current.secretKey,
      webhookSecret: patch.webhookSecret ?? current.webhookSecret,
    };
    this.setRaw('stripe', JSON.stringify(merged));
    return merged;
  }

  isOnboarded(): boolean {
    return this.getRaw('onboarded') === '1';
  }

  setOnboarded(): void {
    this.setRaw('onboarded', '1');
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* ignore */
    }
  }
}
