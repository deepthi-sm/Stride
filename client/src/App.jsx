import { useEffect, useState } from 'react';
import Capture from './Capture.jsx';
import Plan from './Plan.jsx';
import Simulate from './Simulate.jsx';
import Onboarding from './Onboarding.jsx';
import Background from './Background.jsx';
import { useTheme } from './theme.jsx';
import { useCalendar } from './CalendarContext.jsx';
import { auth } from './firebase.js';
import { onAuthStateChanged } from 'firebase/auth';

// The app shell, restyled to the design: a calm scenic background, a slim left
// rail on laptop (bottom bar on mobile), and a single centered content column.
// Onboarding runs first when there is no profile yet; once it saves one, the
// plan (Home) becomes the landing screen. Routing, data fetching, and the
// onboarding gate are unchanged from before — only the look changed.

// Nav order from the design: Home, Simulate, Calendar, Roadmap, Settings.
// Home covers the plan plus its capture sub-view. Calendar, Roadmap, and
// Settings are restyled in later steps; for now they show a calm placeholder so
// nothing breaks.
const NAV = [
  { id: 'plan', label: 'Home', match: ['plan', 'capture'] },
  { id: 'simulate', label: 'Simulate', match: ['simulate'] },
  { id: 'calendar', label: 'Calendar', match: ['calendar'] },
  { id: 'roadmap', label: 'Roadmap', match: ['roadmap'] },
  { id: 'settings', label: 'Settings', match: ['settings'] },
];

function NavIcon({ id }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 };
  if (id === 'plan') {
    return (
      <svg {...common}>
        <path d="M4 11l8-6 8 6" />
        <path d="M6 10v9h12v-9" />
      </svg>
    );
  }
  if (id === 'simulate') {
    return (
      <svg {...common}>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="18" r="2.5" />
        <path d="M6 8.5v4a4 4 0 004 4h5.5" />
      </svg>
    );
  }
  if (id === 'calendar') {
    return (
      <svg {...common}>
        <rect x="4" y="5" width="16" height="15" rx="2.5" />
        <path d="M4 9.5h16M8.5 3v4M15.5 3v4" />
      </svg>
    );
  }
  if (id === 'roadmap') {
    return (
      <svg {...common}>
        <circle cx="12" cy="5" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="12" cy="19" r="2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" />
    </svg>
  );
}

function NavButtons({ view, onNavigate }) {
  return (
    <>
      {NAV.map((item) => (
        <button
          key={item.id}
          type="button"
          title={item.label}
          aria-label={item.label}
          className={`nav-btn${item.match.includes(view) ? ' active' : ''}`}
          onClick={() => onNavigate(item.id)}
        >
          <NavIcon id={item.id} />
        </button>
      ))}
    </>
  );
}

// A calm placeholder for screens that get their design pass in a later step.
function ComingSoon({ title }) {
  return (
    <div className="glass-solid coming-soon fade-in">
      <h2>{title}</h2>
      <p>This screen gets its new look in the next step. Your existing data and actions are untouched.</p>
    </div>
  );
}

// Onboarding completion is remembered per signed-in user, on the device. We do
// NOT treat "the server already has a profile" as the gate: the store keeps one
// global profile, so a fresh visitor would otherwise inherit a prior tester's
// answers and skip straight in. A per-user flag means a new sign-in always sees
// onboarding, while a returning user on the same device goes straight to the app.
function onboardedKey(user) {
  return user ? `stride:onboarded:${user.uid}` : null;
}
function readOnboarded(user) {
  const key = onboardedKey(user);
  if (!key) return false;
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

// A calm full-screen sign-in: the existing Google sign-in (the same one the
// calendar uses) is the front door. Signing in gives the user identity that
// scopes onboarding and, later in a session, the calendar token.
function SignInScreen({ onConnect, busy, error }) {
  return (
    <div className="signin-card glass-solid fade-in">
      <div className="signin-mark" />
      <h1 className="signin-title">Stride</h1>
      <p className="signin-sub">
        The agent that catches you before deadlines collapse. Sign in to set up your week.
      </p>
      <button type="button" className="signin-btn" onClick={onConnect} disabled={busy}>
        {busy ? 'Opening Google…' : 'Continue with Google'}
      </button>
      {error && <p className="home-error signin-error">{error}</p>}
    </div>
  );
}

export default function App() {
  const { vars } = useTheme();
  const { user, connect, busy: authBusy, error: authError } = useCalendar();

  // authReady flips once Firebase has restored (or cleared) the signed-in user,
  // so a returning user is not flashed the sign-in screen on every load.
  const [authReady, setAuthReady] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [view, setView] = useState('plan');
  // Bumping this key remounts the plan so a fresh capture is reflected.
  const [planKey, setPlanKey] = useState(0);

  useEffect(() => onAuthStateChanged(auth, () => setAuthReady(true)), []);

  // Re-read the per-user onboarding flag whenever the signed-in user changes.
  useEffect(() => {
    setOnboarded(readOnboarded(user));
  }, [user]);

  // The phase is derived, never stored: loading -> signin -> onboarding -> ready.
  let phase;
  if (!authReady) phase = 'loading';
  else if (!user) phase = 'signin';
  else if (!onboarded) phase = 'onboarding';
  else phase = 'ready';

  function goPlan() {
    setPlanKey((k) => k + 1);
    setView('plan');
  }

  // Onboarding finished (real answers or the sample): remember it for this user on
  // this device, then route into the app.
  function finishOnboarding() {
    try {
      const key = onboardedKey(user);
      if (key) localStorage.setItem(key, '1');
    } catch {
      // ignore storage failures (private mode, etc.); the app still proceeds
    }
    setOnboarded(true);
    goPlan();
  }

  if (phase === 'loading') {
    return (
      <div className="stride-shell" style={vars}>
        <Background />
        <div className="stride-app">
          <div className="stride-content">
            <div className="stride-col">
              <div className="glass-solid state-card fade-in">
                <p className="home-note">Loading…</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'signin') {
    return (
      <div className="stride-shell" style={vars}>
        <Background />
        <div className="signin-screen">
          <SignInScreen
            onConnect={() => connect().catch(() => {})}
            busy={authBusy}
            error={authError}
          />
        </div>
      </div>
    );
  }

  // Onboarding keeps its current screen for now; it gets the design pass later.
  if (phase === 'onboarding') {
    return (
      <main className="screen">
        <Onboarding onComplete={finishOnboarding} />
      </main>
    );
  }

  return (
    <div className="stride-shell" style={vars}>
      <Background />
      <div className="stride-app">
        <nav className="stride-rail">
          <div className="stride-logo" />
          <NavButtons view={view} onNavigate={(id) => (id === 'plan' ? goPlan() : setView(id))} />
        </nav>

        <div className="stride-content">
          <div className={`stride-col${view === 'plan' ? ' home' : ''}`}>
            {view === 'plan' && <Plan key={planKey} />}
            {view === 'capture' && <Capture onCaptured={goPlan} />}
            {view === 'simulate' && <Simulate />}
            {view === 'calendar' && <ComingSoon title="Calendar" />}
            {view === 'roadmap' && <ComingSoon title="Roadmap" />}
            {view === 'settings' && <ComingSoon title="Settings" />}
          </div>
        </div>

        {view === 'plan' && (
          <button type="button" className="capture-bar" onClick={() => setView('capture')}>
            <span className="ph">Add anything…</span>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0014 0M12 18v3" />
            </svg>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="6" width="18" height="14" rx="3" />
              <circle cx="12" cy="13" r="3.4" />
            </svg>
            <span className="plus">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
          </button>
        )}

        <nav className="stride-bottom">
          <NavButtons view={view} onNavigate={(id) => (id === 'plan' ? goPlan() : setView(id))} />
        </nav>
      </div>
    </div>
  );
}
