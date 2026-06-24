/** The login-protected admin area. Slice 2 establishes auth: it signs you in with
 *  your OpenMasjidOS login when embedded (SSO), and falls back to a local admin
 *  password standalone. Payments, appeals and the donations log fill it out in
 *  later slices. */
import { useEffect, useState } from 'react';
import { Bell, ExternalLink, KeyRound, LogIn, LogOut, ShieldCheck, Sparkles } from 'lucide-react';
import {
  getSession,
  login,
  logout,
  sendTestNotification,
  setupAdmin,
  type AppInfo,
  type NotifyTestResult,
  type Session,
} from './api';

const SOURCE_URL = 'https://github.com/hasan-ismail/OpenMasjidDonations';

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

  if (!loaded) {
    return (
      <main className="auth-wrap">
        <span className="spinner" aria-label="Loading" />
      </main>
    );
  }

  if (session?.authed) return <AdminHome info={info} session={session} onSignedOut={refresh} />;
  if (session?.needsSetup) return <Setup onDone={refresh} />;
  if (session?.sso.enabled) return <SsoPrompt />;
  return <Login onDone={refresh} />;
}

// ── Sign-in states ────────────────────────────────────────────────────────────

function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth-wrap">
      <section className="glass-raised auth-card">
        <div className="auth-logo" aria-hidden="true">
          <ShieldCheck size={34} />
        </div>
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
      <p className="auth-sub muted">This protects your donation settings. You’ll use it to sign in from now on.</p>
      <form onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="pw">New password</label>
          <input id="pw" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="pw2">Confirm password</label>
          <input id="pw2" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : <KeyRound size={16} />} Set password
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
        <div className="field">
          <label className="label" htmlFor="pw">Password</label>
          <input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </div>
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

// ── Signed-in home ──────────────────────────────────────────────────────────

function AdminHome({ info, session, onSignedOut }: { info: AppInfo | null; session: Session; onSignedOut: () => void }) {
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

      <section className="glass panel">
        <div className="row">
          <Sparkles size={18} className="panel-ico" aria-hidden="true" />
          <div>
            <h2 className="section-title-inline">Payments &amp; appeals</h2>
            <p className="muted">Coming next: connect Stripe, then create your appeals with preset and custom amounts.</p>
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
        <a href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
          Source code <ExternalLink size={12} />
        </a>{' '}
        · AGPL-3.0
      </p>
    </main>
  );
}

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
