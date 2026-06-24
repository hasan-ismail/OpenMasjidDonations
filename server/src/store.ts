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

export interface Admin extends Cred {
  name?: string;
  createdAt: string;
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

  close(): void {
    try {
      this.db.close();
    } catch {
      /* ignore */
    }
  }
}
