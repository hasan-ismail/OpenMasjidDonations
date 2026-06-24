import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ShieldCheck } from 'lucide-react';
import { getAppInfo, type AppInfo } from './api';
import { useOmosAppearanceSync } from './prefs';
import { Scene, Brand, ThemeToggle } from './ui';
import { AdminApp } from './admin';
import { DonatePage, parseCampaignPath } from './donate';

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

  // Inherit the dashboard's live theme + wallpaper + accent while embedded (polled
  // via our same-origin relay so it isn't mixed-content-blocked on our HTTPS page).
  useOmosAppearanceSync(info?.embedded);

  const path = typeof location !== 'undefined' ? location.pathname.replace(/\/+$/, '') : '/';
  const campaign = parseCampaignPath(path);
  const isAdmin = path.startsWith('/admin');
  // First boot: until setup is done there's nothing for donors at the root, so send
  // the admin straight to setup. Never redirect a campaign link.
  const goToSetup = !!info && !info.onboarded && !isAdmin && !campaign;

  useEffect(() => {
    if (goToSetup) window.location.replace('/admin');
  }, [goToSetup]);

  // A campaign donation page is its own full-screen experience (own Scene + chrome).
  if (campaign) return <DonatePage slug={campaign.slug} token={campaign.token} />;

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
        <h1 className="hero-title">Donations</h1>
        <p className="hero-lead">
          This masjid's donation pages are managed here. Open a specific appeal's link to give, or sign in to
          manage appeals and payments.
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
