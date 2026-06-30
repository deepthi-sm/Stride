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
const GUEST_IDENTITY = { uid: 'guest' };

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

function GoogleG() {
  return (
    <svg className="signin-gicon" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

// The sign-in front door, matching the design: brand lockup, headline, the white
// Google button (the real Firebase sign-in), and a guest path that keeps work on
// this device and defers Google to whenever a calendar action actually needs it.
function SignInScreen({ onConnect, onGuest, busy, error }) {
  return (
    <div className="signin-card glass-solid fade-in">
      <div className="signin-brand">
        <span className="signin-mark" />
        <span className="signin-brandname">Stride</span>
      </div>
      <h1 className="signin-title">Catches you before<br />the deadline does.</h1>
      <p className="signin-sub">
        Your AI agent plans the week, drafts the work, and steps in when you fall behind.
      </p>
      <button type="button" className="signin-google" onClick={onConnect} disabled={busy}>
        <GoogleG />
        {busy ? 'Opening Google…' : 'Continue with Google'}
      </button>
      <button type="button" className="signin-guest" onClick={onGuest} disabled={busy}>
        Continue as guest
      </button>
      {error && <p className="home-error signin-error">{error}</p>}
      <p className="signin-foot">
        Stride uses Google sign-in so it can add events straight to your calendar. Guest mode keeps
        everything on this device.
      </p>
    </div>
  );
}

export default function App() {
  const { vars } = useTheme();
  const { user, connect, busy: authBusy, error: authError } = useCalendar();

  // authReady flips once Firebase has restored (or cleared) the signed-in user,
  // so a returning user is not flashed the sign-in screen on every load.
  const [authReady, setAuthReady] = useState(false);
  // Guest mode is a local identity: no Google account, work stays on this device.
  // It is sticky for the session so a later calendar sign-in does not bounce the
  // user back through onboarding under a different identity.
  const [guest, setGuest] = useState(() => {
    try {
      return localStorage.getItem('stride:guest') === '1';
    } catch {
      return false;
    }
  });
  const [onboarded, setOnboarded] = useState(false);
  const [view, setView] = useState('plan');
  // Bumping this key remounts the plan so a fresh capture is reflected.
  const [planKey, setPlanKey] = useState(0);

  // The routing identity: a guest stays a guest even after a real Google sign-in
  // (which calendar features may trigger), so onboarding is never re-shown.
  const identity = guest ? GUEST_IDENTITY : user;

  useEffect(() => onAuthStateChanged(auth, () => setAuthReady(true)), []);

  // Re-read the per-identity onboarding flag whenever the identity changes.
  useEffect(() => {
    setOnboarded(readOnboarded(identity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, guest]);

  // The phase is derived, never stored: loading -> signin -> onboarding -> ready.
  // A guest skips the Firebase wait entirely.
  let phase;
  if (!authReady && !guest) phase = 'loading';
  else if (!identity) phase = 'signin';
  else if (!onboarded) phase = 'onboarding';
  else phase = 'ready';

  function goPlan() {
    setPlanKey((k) => k + 1);
    setView('plan');
  }

  function continueAsGuest() {
    try {
      localStorage.setItem('stride:guest', '1');
    } catch {
      // ignore storage failures; guest still works for this session
    }
    setGuest(true);
  }

  // Onboarding finished (real answers or the sample): remember it for this
  // identity on this device, then route into the app.
  function finishOnboarding() {
    try {
      const key = onboardedKey(identity);
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
            onGuest={continueAsGuest}
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
