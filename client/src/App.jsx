import { useEffect, useState } from 'react';
import Capture from './Capture.jsx';
import Plan from './Plan.jsx';
import Simulate from './Simulate.jsx';
import Onboarding from './Onboarding.jsx';
import { CalendarStatus } from './CalendarButtons.jsx';

// One screen at a time, calm, never a dashboard. Onboarding runs first when
// there is no profile yet; once it saves one, the plan becomes home. Capture and
// simulate are one understated tap away.
export default function App() {
  // 'loading' until we know whether onboarding is needed, then 'onboarding' or
  // 'ready' for the main app.
  const [phase, setPhase] = useState('loading');
  const [view, setView] = useState('plan');
  // Bumping this key remounts the plan so a fresh capture is reflected.
  const [planKey, setPlanKey] = useState(0);

  // On first load, decide between onboarding and the plan from the saved profile.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((profile) => {
        if (cancelled) return;
        setPhase(profile && profile.role ? 'ready' : 'onboarding');
      })
      .catch(() => {
        if (!cancelled) setPhase('onboarding');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function goPlan() {
    setPlanKey((k) => k + 1);
    setView('plan');
  }

  // Onboarding finished: the profile is saved, so route into the dashboard.
  function finishOnboarding() {
    goPlan();
    setPhase('ready');
  }

  if (phase === 'loading') {
    return (
      <main className="screen">
        <div className="panel">
          <p className="prompt">Loading…</p>
        </div>
      </main>
    );
  }

  if (phase === 'onboarding') {
    return (
      <main className="screen">
        <Onboarding onComplete={finishOnboarding} />
      </main>
    );
  }

  const tabs = [
    { id: 'plan', label: 'Plan' },
    { id: 'simulate', label: 'Simulate' },
    { id: 'capture', label: 'Capture' },
  ];

  return (
    <main className="screen">
      <nav className="nav">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`nav-link${view === t.id ? ' active' : ''}`}
            onClick={() => (t.id === 'plan' ? goPlan() : setView(t.id))}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <CalendarStatus />

      {view === 'capture' && <Capture onCaptured={goPlan} />}
      {view === 'simulate' && <Simulate />}
      {view === 'plan' && <Plan key={planKey} />}
    </main>
  );
}
