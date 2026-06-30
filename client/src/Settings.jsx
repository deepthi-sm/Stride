import { useEffect, useState } from 'react';
import { useTheme } from './theme.jsx';
import { useCalendar } from './CalendarContext.jsx';

// The settings screen: a real read-back of the saved profile, the theme switcher
// wired to the existing theme engine, the Google Calendar connection (reusing the
// existing calendar wiring, not changing it), and sign out. Every label here comes
// from the saved profile; nothing is invented.

const ROLE = { student: 'Student', professional: 'Professional', founder: 'Founder or freelancer', other: 'Planner' };
const WINDOW_CHIP = {
  early_morning: 'Early bird',
  afternoon: 'Afternoon person',
  evening: 'Evening person',
  late_night: 'Night owl',
  varies: 'Flexible hours',
};
const WINDOW_PHRASE = {
  early_morning: 'early morning',
  afternoon: 'afternoon',
  evening: 'evening',
  late_night: 'late night',
  varies: 'whenever it fits',
};
const DEADLINE_CHIP = { early: 'Finishes early', on_time: 'Right on time', close: 'Pushes it close', last_minute: 'Last minute' };
const DEADLINE_PHRASE = {
  early: 'finishes early',
  on_time: 'lands on time',
  close: 'leaves things close',
  last_minute: 'works last minute',
};
const SLOWDOWN_CHIP = {
  underestimate: 'Underestimates time',
  overwhelmed: 'Big tasks stall me',
  distracted: 'Gets distracted',
  avoid_starting: 'Puts off starting',
  forgetful: 'Forgets things',
};
const SLIPS_CHIP = {
  deadlines: 'Deadlines slip',
  messages: 'Messages slip',
  bills: 'Bills slip',
  goals: 'Goals slip',
  none: 'Little slips',
};
const RESCUE_CHIP = {
  rebuild: 'Rebuild the plan',
  protect: 'Protect what matters',
  suggest_drop: 'Tell me what to drop',
  draft_message: 'Draft a message',
};

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M20 14.5A8 8 0 119.5 4a6.2 6.2 0 0010.5 10.5z" />
    </svg>
  );
}
function SunsetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M17 18a5 5 0 00-10 0" />
      <path d="M12 9V3M4.9 10.9l-1-1M19.1 10.9l1-1M2 18h2M20 18h2M3 21h18" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

const THEME_META = [
  { value: 'day', label: 'Day', swatch: 'linear-gradient(135deg,#9fc6f2,#e8f2fb)', icon: SunIcon },
  { value: 'evening', label: 'Evening', swatch: 'linear-gradient(135deg,#4a2b50,#c47556)', icon: SunsetIcon },
  { value: 'night', label: 'Night', swatch: 'linear-gradient(135deg,#10102a,#3a2a5c)', icon: MoonIcon },
  { value: 'auto', label: 'Follow the clock', swatch: 'linear-gradient(135deg,#9fc6f2,#221b40)', icon: ClockIcon },
];

function profileChips(profile) {
  if (!profile) return [];
  const chips = [];
  if (ROLE[profile.role]) chips.push(ROLE[profile.role]);
  if (WINDOW_CHIP[profile.productivityWindow]) chips.push(WINDOW_CHIP[profile.productivityWindow]);
  if (DEADLINE_CHIP[profile.deadlineStyle]) chips.push(DEADLINE_CHIP[profile.deadlineStyle]);
  for (const s of profile.slowdowns || []) if (SLOWDOWN_CHIP[s]) chips.push(SLOWDOWN_CHIP[s]);
  if (SLIPS_CHIP[profile.slips]) chips.push(SLIPS_CHIP[profile.slips]);
  if (RESCUE_CHIP[profile.rescueStrategy]) chips.push(RESCUE_CHIP[profile.rescueStrategy]);
  return chips;
}

function profileLine(profile) {
  if (!profile) return '';
  const role = ROLE[profile.role] || 'Planner';
  const win = WINDOW_PHRASE[profile.productivityWindow];
  const dl = DEADLINE_PHRASE[profile.deadlineStyle];
  const parts = [role];
  if (win) parts.push(`best in the ${win}`);
  if (dl) parts.push(dl);
  return parts.join(' · ');
}

function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function Settings({ onSignOut }) {
  const { theme, setTheme } = useTheme();
  const { user, accessToken, busy, error, connect, disconnect } = useCalendar();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const name = user?.displayName || (user?.email ? user.email.split('@')[0] : 'Guest');
  const initial = (name[0] || 'G').toUpperCase();
  const chips = profileChips(profile);
  const connected = Boolean(user && accessToken);

  return (
    <div className="set fade-in">
      <h1 className="set-title">Settings</h1>

      <div className="set-profile glass-solid">
        <div className="set-avatar">{initial}</div>
        <div className="set-profile-body">
          <div className="set-name">{name}</div>
          {profile ? (
            <div className="set-profile-line">{profileLine(profile)}</div>
          ) : (
            <div className="set-profile-line">No profile saved yet.</div>
          )}
        </div>
      </div>

      {chips.length > 0 && (
        <>
          <div className="set-section-label">Your profile</div>
          <div className="set-chips">
            {chips.map((c, i) => (
              <span key={i} className="set-chip">{c}</span>
            ))}
          </div>
        </>
      )}

      <div className="set-section-label">Theme</div>
      <div className="set-themes">
        {THEME_META.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.value}
              type="button"
              className={`set-theme${theme === t.value ? ' on' : ''}`}
              onClick={() => setTheme(t.value)}
            >
              <span className="set-theme-swatch" style={{ background: t.swatch }}>
                <Icon />
              </span>
              <span className="set-theme-label">{t.label}</span>
              {theme === t.value && <span className="set-theme-check">✓</span>}
            </button>
          );
        })}
      </div>

      <div className="set-section-label">Connection</div>
      <div className="set-connection glass-solid">
        <div className="set-conn-left">
          <GoogleG />
          <div>
            <div className="set-conn-name">Google Calendar</div>
            <div className="set-conn-sub">
              {connected
                ? `Connected as ${user.email || 'your account'}`
                : user
                ? 'Signed in, reconnect to add events'
                : 'Not connected'}
            </div>
          </div>
        </div>
        {connected ? (
          <span className="set-conn-pill">Connected</span>
        ) : (
          <button
            type="button"
            className="set-conn-btn"
            onClick={() => connect().catch(() => {})}
            disabled={busy}
          >
            {busy ? 'Opening…' : user ? 'Reconnect' : 'Connect'}
          </button>
        )}
      </div>
      {error && <p className="set-conn-err">{error}</p>}

      <button type="button" className="set-signout" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}
