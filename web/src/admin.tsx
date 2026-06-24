/** The login-protected admin area.
 *  - Standalone first run: create an admin password, then a guided setup wizard.
 *  - Under OpenMasjidOS: sign in via the dashboard (SSO), then the same wizard.
 *  The wizard collects masjid details + Stripe keys (with instructions). Stripe's
 *  SECRET key is sent to the server and never comes back to the browser. */
import { useEffect, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Landmark,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  completeOnboarding,
  getSession,
  getSettings,
  login,
  logout,
  saveMasjid,
  saveStripe,
  sendTestNotification,
  setupAdmin,
  testStripe,
  type AppInfo,
  type MasjidProfile,
  type NotifyTestResult,
  type Session,
  type Settings,
  type StripeStatus,
  type VerifyResult,
} from './api';

const SOURCE_URL = 'https://github.com/hasan-ismail/OpenMasjidDonations';
const STRIPE_KEYS_URL = 'https://dashboard.stripe.com/apikeys';
const STRIPE_WEBHOOKS_URL = 'https://dashboard.stripe.com/webhooks';

export function AdminApp({ info }: { info: AppInfo | null }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = () =>
    getSession()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoaded(true));

  useEffect(() => {
    void refresh();
  }, []);

  if (!loaded) return <Centered><span className="spinner" aria-label="Loading" /></Centered>;
  if (session?.authed) return <AdminConsole info={info} session={session} onSignedOut={refresh} />;
  if (session?.needsSetup) return <Setup onDone={refresh} />;
  if (session?.sso.enabled) return <SsoPrompt />;
  return <Login onDone={refresh} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="auth-wrap">{children}</main>;
}

// ── Sign-in states ────────────────────────────────────────────────────────────

function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth-wrap">
      <section className="glass-raised auth-card">
        <div className="auth-logo" aria-hidden="true"><ShieldCheck size={34} /></div>
        <h1 className="auth-title">{title}</h1>
        {children}
      </section>
    </main>
  );
}

function Setup({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Please choose a password of at least 8 characters.');
    if (password !== confirm) return setError('The two passwords don’t match.');
    setBusy(true);
    try {
      await setupAdmin(password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Create your admin password">
      <p className="auth-sub muted">
        This is the first time this app has run. Choose a password to protect your donation settings —
        you’ll use it to sign in from now on.
      </p>
      <form onSubmit={submit}>
        <Field id="pw" label="New password">
          <input id="pw" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
        <Field id="pw2" label="Confirm password">
          <input id="pw2" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : <KeyRound size={16} />} Set password &amp; continue
        </button>
      </form>
    </AuthCard>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Sign in">
      <p className="auth-sub muted">Enter your admin password to manage your donation pages.</p>
      <form onSubmit={submit}>
        <Field id="pw" label="Password">
          <input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : <LogIn size={16} />} Sign in
        </button>
      </form>
    </AuthCard>
  );
}

function SsoPrompt() {
  return (
    <AuthCard title="Sign in through OpenMasjidOS">
      <p className="auth-sub muted">
        This app uses your OpenMasjidOS login. Open it from your OpenMasjidOS dashboard — press <b>Open</b> on the
        Donations app — and you’ll be signed in automatically.
      </p>
    </AuthCard>
  );
}

// ── Console: loads settings, then routes to the wizard or the home ──────────────

function AdminConsole({ info, session, onSignedOut }: { info: AppInfo | null; session: Session; onSignedOut: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = () =>
    getSettings()
      .then(setSettings)
      .catch(() => setSettings(null))
      .finally(() => setLoaded(true));

  useEffect(() => {
    void reload();
  }, []);

  if (!loaded) return <Centered><span className="spinner" aria-label="Loading" /></Centered>;
  if (!settings) return <Centered><p className="muted">Couldn’t load your settings. Please refresh.</p></Centered>;

  if (!settings.onboarded) return <Onboarding settings={settings} onReload={reload} />;
  return <AdminHome info={info} session={session} settings={settings} onReload={reload} onSignedOut={onSignedOut} />;
}

// ── First-run wizard ────────────────────────────────────────────────────────

function Onboarding({ settings, onReload }: { settings: Settings; onReload: () => void }) {
  const [finishing, setFinishing] = useState(false);

  const finish = async () => {
    setFinishing(true);
    try {
      await completeOnboarding();
      onReload();
    } catch {
      setFinishing(false);
    }
  };

  return (
    <main className="admin">
      <div className="page-head">
        <h1 className="page-title">Let’s set up your donations</h1>
        <p className="page-sub">A couple of details and your Stripe keys — then you’re ready to create appeals.</p>
      </div>
      <MasjidCard masjid={settings.masjid} onSaved={onReload} />
      <StripeCard stripe={settings.stripe} onSaved={onReload} />
      <section className="glass panel">
        <div className="row-between">
          <p className="muted" style={{ margin: 0 }}>
            {!settings.masjid.name.trim()
              ? 'Add and save your masjid name above to finish.'
              : settings.stripe.configured
                ? 'Stripe is connected ✓ — you can change anything later.'
                : 'You can add Stripe now or later — change anything anytime.'}
          </p>
          <button className="btn btn--primary" onClick={finish} disabled={finishing || !settings.masjid.name.trim()}>
            {finishing ? <span className="spinner" /> : <CheckCircle2 size={16} />} Finish setup
          </button>
        </div>
      </section>
    </main>
  );
}

// ── Signed-in home ──────────────────────────────────────────────────────────

function AdminHome({
  info,
  session,
  settings,
  onReload,
  onSignedOut,
}: {
  info: AppInfo | null;
  session: Session;
  settings: Settings;
  onReload: () => void;
  onSignedOut: () => void;
}) {
  const embedded = !!info?.embedded;
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await logout();
    } catch {
      /* ignore */
    }
    onSignedOut();
  };

  return (
    <main className="admin">
      <div className="page-head">
        <h1 className="page-title">Admin</h1>
        <p className="page-sub">
          {session.sso.username ? `Signed in as ${session.sso.username}` : 'Signed in'}
          {embedded ? ' · via OpenMasjidOS' : ''}
        </p>
      </div>

      <MasjidCard masjid={settings.masjid} onSaved={onReload} />
      <StripeCard stripe={settings.stripe} onSaved={onReload} />

      <section className="glass panel">
        <div className="row">
          <Sparkles size={18} className="panel-ico" aria-hidden="true" />
          <div>
            <h2 className="section-title-inline">Appeals</h2>
            <p className="muted">Coming next: create your appeals (General Fund, Zakat, Building Fund…) with preset and custom amounts.</p>
          </div>
        </div>
      </section>

      <Notifications embedded={embedded} />

      <section className="glass panel">
        <div className="row-between">
          <div className="row">
            <ShieldCheck size={18} className="panel-ico" aria-hidden="true" />
            <span className="muted">
              {embedded ? 'Signed in with your OpenMasjidOS login.' : 'Signed in with your local admin password.'}
            </span>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={signOut} disabled={signingOut}>
            {signingOut ? <span className="spinner" /> : <LogOut size={15} />} Sign out
          </button>
        </div>
      </section>

      <p className="admin-foot faint">
        OpenMasjid Donations v{info?.version ?? __APP_VERSION__} ·{' '}
        <a href={SOURCE_URL} target="_blank" rel="noreferrer noopener">Source code <ExternalLink size={12} /></a> · AGPL-3.0
      </p>
    </main>
  );
}

// ── Masjid details card ───────────────────────────────────────────────────────

function MasjidCard({ masjid, onSaved }: { masjid: MasjidProfile; onSaved: () => void }) {
  const [form, setForm] = useState<MasjidProfile>(masjid);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof MasjidProfile) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await saveMasjid(form);
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass panel">
      <div className="card-head">
        <Landmark size={18} className="panel-ico" aria-hidden="true" />
        <div>
          <h2 className="section-title-inline">Your masjid</h2>
          <p className="muted">Shown on your donation page and receipts.</p>
        </div>
      </div>
      <div className="grid2">
        <Field id="m-name" label="Masjid name">
          <input id="m-name" className="input" value={form.name} onChange={set('name')} placeholder="e.g. Madani Masjid" />
        </Field>
        <Field id="m-cur" label="Currency (ISO code)">
          <input id="m-cur" className="input" value={form.currency} onChange={set('currency')} placeholder="GBP" maxLength={8} />
        </Field>
      </div>
      <Field id="m-addr" label="Address (optional)">
        <input id="m-addr" className="input" value={form.address} onChange={set('address')} />
      </Field>
      <div className="grid2">
        <Field id="m-email" label="Contact email (optional)">
          <input id="m-email" className="input" type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field id="m-phone" label="Phone (optional)">
          <input id="m-phone" className="input" value={form.phone} onChange={set('phone')} />
        </Field>
      </div>
      <Field id="m-web" label="Website (optional)">
        <input id="m-web" className="input" value={form.website} onChange={set('website')} placeholder="https://" />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="row-between">
        <span className="hint">{saved ? 'Saved ✓' : ''}</span>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={busy}>
          {busy ? <span className="spinner" /> : null} Save masjid details
        </button>
      </div>
    </section>
  );
}

// ── Stripe / payments card ────────────────────────────────────────────────────

function TestModeBadge({ mode }: { mode: StripeStatus['mode'] }) {
  if (mode === 'test') return <span className="badge badge--test">TEST MODE</span>;
  if (mode === 'live') return <span className="badge badge--live">LIVE</span>;
  return null;
}

function StripeInstructions() {
  return (
    <details className="steps-details">
      <summary>Where do I get these from Stripe?</summary>
      <ol className="steps">
        <li>
          Create a free account at <a href="https://stripe.com" target="_blank" rel="noreferrer noopener">stripe.com</a> (or sign in).
        </li>
        <li>
          Keep <b>Test mode</b> on (the toggle at the top of the Stripe dashboard) while you try things out — use real
          <b> live</b> keys only when you’re ready to take real money.
        </li>
        <li>
          Open <a href={STRIPE_KEYS_URL} target="_blank" rel="noreferrer noopener">Developers → API keys <ExternalLink size={11} /></a>.
          Copy the <b>Publishable key</b> (starts <code>pk_</code>) and click <b>Reveal</b> then copy the <b>Secret key</b> (starts <code>sk_</code>).
        </li>
        <li>Paste both below and save. Your secret key stays on this device and is never shown in the browser again.</li>
        <li className="muted">
          <b>Webhook secret</b> (optional, advanced): only needed if you make this page reachable from the public internet.
          In <a href={STRIPE_WEBHOOKS_URL} target="_blank" rel="noreferrer noopener">Developers → Webhooks <ExternalLink size={11} /></a> add an
          endpoint at <code>/api/stripe/webhook</code> and copy its signing secret (starts <code>whsec_</code>).
        </li>
      </ol>
    </details>
  );
}

function StripeCard({ stripe, onSaved }: { stripe: StripeStatus; onSaved: () => void }) {
  const [pk, setPk] = useState(stripe.publishableKey);
  const [sk, setSk] = useState(''); // never prefilled — the server never sends it back
  const [whsec, setWhsec] = useState('');
  const [showSk, setShowSk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [verify, setVerify] = useState<VerifyResult | null>(null);

  const save = async () => {
    setBusy(true);
    setError('');
    setVerify(null);
    try {
      const patch: { publishableKey?: string; secretKey?: string; webhookSecret?: string } = {};
      // Send publishable only if changed; secret/webhook only if the admin typed one.
      if (pk !== stripe.publishableKey) patch.publishableKey = pk.trim();
      if (sk.trim()) patch.secretKey = sk.trim();
      if (whsec.trim()) patch.webhookSecret = whsec.trim();
      const res = await saveStripe(patch);
      setSk('');
      setWhsec('');
      if (res.verify) setVerify(res.verify);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setError('');
    try {
      setVerify(await testStripe());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="glass panel">
      <div className="card-head">
        <KeyRound size={18} className="panel-ico" aria-hidden="true" />
        <div className="card-head__main">
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            <h2 className="section-title-inline">Payments (Stripe)</h2>
            <TestModeBadge mode={stripe.mode} />
            {stripe.configured ? (
              <span className="status-pill status-pill--ok"><CheckCircle2 size={13} /> Connected</span>
            ) : (
              <span className="status-pill">Not set up yet</span>
            )}
          </div>
          <p className="muted">Donors pay by card through Stripe. Your secret key is stored only on this device.</p>
        </div>
      </div>

      <StripeInstructions />

      {stripe.keysMismatch && (
        <p className="form-error" role="alert">Your publishable and secret keys are in different modes (one test, one live). Use a matching pair.</p>
      )}

      <Field id="pk" label="Publishable key (pk_…)">
        <input id="pk" className="input mono" value={pk} onChange={(e) => setPk(e.target.value)} placeholder="pk_test_…" autoComplete="off" spellCheck={false} />
      </Field>

      <Field id="sk" label={stripe.hasSecretKey ? 'Secret key (sk_…) — saved; leave blank to keep' : 'Secret key (sk_…)'}>
        <div className="input-affix">
          <input
            id="sk"
            className="input mono"
            type={showSk ? 'text' : 'password'}
            value={sk}
            onChange={(e) => setSk(e.target.value)}
            placeholder={stripe.hasSecretKey ? '•••••••• (unchanged)' : 'sk_test_…'}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="affix-btn" onClick={() => setShowSk((s) => !s)} aria-label={showSk ? 'Hide' : 'Show'}>
            {showSk ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </Field>

      <details className="steps-details">
        <summary>Webhook secret (optional)</summary>
        <Field id="whsec" label={stripe.hasWebhookSecret ? 'Webhook secret (whsec_…) — saved; leave blank to keep' : 'Webhook secret (whsec_…)'}>
          <input id="whsec" className="input mono" value={whsec} onChange={(e) => setWhsec(e.target.value)} placeholder="whsec_…" autoComplete="off" spellCheck={false} />
        </Field>
      </details>

      {error && <p className="form-error" role="alert">{error}</p>}
      {verify && (
        <p className={verify.ok ? 'hint' : 'form-error'} role="status">
          {verify.ok
            ? `Stripe accepted your key${verify.mode ? ` (${verify.mode} mode)` : ''}. ✓`
            : verify.message}
        </p>
      )}

      <div className="row-between" style={{ marginBlockStart: '0.4rem' }}>
        <button className="btn btn--ghost btn--sm" onClick={test} disabled={testing || !stripe.hasSecretKey}>
          {testing ? <span className="spinner" /> : <RefreshCw size={14} />} Test connection
        </button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={busy}>
          {busy ? <span className="spinner" /> : null} Save payment keys
        </button>
      </div>
    </section>
  );
}

// ── Notifications ─────────────────────────────────────────────────────────────

function Notifications({ embedded }: { embedded: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NotifyTestResult | null>(null);
  const [error, setError] = useState('');

  const test = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await sendTestNotification());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const msg = result
    ? result.delivered
      ? 'Sent! Check your masjid’s notification channel.'
      : result.reason === 'disabled'
        ? 'Notifications aren’t turned on in OpenMasjidOS yet (Settings → Notifications).'
        : !result.baseUrlSet || !result.hasSecret
          ? 'Notifications work when this app is launched from OpenMasjidOS.'
          : 'Couldn’t deliver right now — check your OpenMasjidOS notification settings.'
    : '';

  return (
    <section className="glass panel">
      <div className="row-between">
        <div className="row">
          <Bell size={18} className="panel-ico" aria-hidden="true" />
          <div>
            <h2 className="section-title-inline">Notifications</h2>
            <p className="muted">
              {embedded
                ? 'Relay alerts (like new donations) to your masjid’s channel through OpenMasjidOS.'
                : 'When launched from OpenMasjidOS, this app can alert your masjid’s channel about new donations.'}
            </p>
          </div>
        </div>
        <button className="btn btn--sm" onClick={test} disabled={busy}>
          {busy ? <span className="spinner" /> : <Bell size={15} />} Send test
        </button>
      </div>
      {(msg || error) && (
        <p className={error ? 'form-error' : 'hint'} role="status" style={{ marginBlockStart: '0.6rem' }}>
          {error || msg}
        </p>
      )}
    </section>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}
