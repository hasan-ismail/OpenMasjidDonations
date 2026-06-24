import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ShieldCheck } from 'lucide-react';
import { getAppInfo, type AppInfo } from './api';
import { useOmosAppearanceSync } from './prefs';
import { Scene, Brand, ThemeToggle } from './ui';
import { AdminApp } from './admin';

export function App() {
  const reduce = useReducedMotion();
  const [info, setInfo] = useState<AppInfo | null>(null);

  // Bootstrap: learn our version + whether we're embedded under OpenMasjidOS.
  useEffect(() => {
    let live = true;
    getAppInfo()
      .then((i) => live && setInfo(i))
      .catch(() => {
        /* shell still renders standalone */
      });
    return () => {
      live = false;
    };
  }, []);

  // While embedded, follow the dashboard's live theme + wallpaper changes (both the
  // public site and the admin area inherit the platform look).
  useOmosAppearanceSync(info?.omosBase);

  const isAdmin = typeof location !== 'undefined' && location.pathname.replace(/\/+$/, '').startsWith('/admin');

  // First boot: until the admin has finished setup there's nothing for donors to
  // see, so the landing page sends them straight into the admin setup.
  const goToSetup = !!info && !info.onboarded && !isAdmin;
  useEffect(() => {
    if (goToSetup) window.location.replace('/admin');
  }, [goToSetup]);

  return (
    <div className="shell">
      <Scene />
      <header className="topbar">
        <Brand />
        <div className="spacer" />
        <ThemeToggle />
      </header>
      {goToSetup ? (
        <main className="auth-wrap"><span className="spinner" aria-label="Opening setup" /></main>
      ) : isAdmin ? (
        <AdminApp info={info} />
      ) : (
        <PublicHome info={info} reduce={!!reduce} />
      )}
    </div>
  );
}

function PublicHome({ info, reduce }: { info: AppInfo | null; reduce: boolean }) {
  const rise = reduce ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 } };
  return (
    <main className="hero">
      <motion.section className="glass-raised hero-card" {...rise} transition={{ duration: reduce ? 0 : 0.5, ease: 'easeOut' }}>
        <div className="hero-emblem" aria-hidden="true">
          <ShieldCheck size={32} />
        </div>
        <h1 className="hero-title">Welcome</h1>
        <p className="hero-lead">
          Your masjid's donation page is getting ready. Soon you'll be able to create appeals, set
          suggested amounts, and take card donations securely with Stripe — all on your own network.
        </p>
        <div className="hero-note">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>Self-hosted and private. Card details go straight to Stripe — never through this app.</span>
        </div>
        <p className="hero-foot muted">
          {info?.embedded ? 'Connected to OpenMasjidOS' : 'Running standalone'}
          {' · '}v{info?.version ?? __APP_VERSION__}
          {' · '}
          <a href="/admin">Admin</a>
        </p>
      </motion.section>
    </main>
  );
}
