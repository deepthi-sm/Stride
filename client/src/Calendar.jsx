import { useEffect, useState } from 'react';
import { useCalendar } from './CalendarContext.jsx';
import { addTaskToCalendar } from './calendar.js';

// The current-week view. Real tasks come from the same GET /api/plan the rest of
// the app reads, placed on their due dates. Chips are colored by risk band, so
// at-risk (high/critical) tasks read amber. "Sync to Google Calendar" writes the
// week's tasks through the existing calendar wiring and only flips to its
// confirmed state once the real write lands.

const RISK_CLASS = (band) => (['low', 'medium', 'high', 'critical'].includes(band) ? band : 'low');
const WD = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
// Monday as the first day of the week.
function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return d;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export default function Calendar() {
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const { ensureToken } = useCalendar();
  const [syncState, setSyncState] = useState('idle'); // idle | working | done | error
  const [syncMsg, setSyncMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/plan');
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Could not load your week.');
        if (!cancelled) setPlan(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const today = new Date();
  const weekStart = startOfWeek(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const todayKey = ymd(today);

  const tasks = plan?.tasks ?? [];
  const byDay = {};
  for (const t of tasks) {
    if (!t.deadline) continue;
    (byDay[t.deadline] = byDay[t.deadline] || []).push(t);
  }
  const weekTasks = days.flatMap((d) => byDay[ymd(d)] || []);

  const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const rangeLabel = `${fmt(weekStart)} – ${fmt(addDays(weekStart, 6))}`;

  async function sync() {
    if (syncState === 'working' || syncState === 'done') return;
    if (!weekTasks.length) {
      setSyncMsg('No tasks fall in this week yet.');
      setSyncState('error');
      return;
    }
    setSyncState('working');
    setSyncMsg('');
    try {
      const token = await ensureToken();
      let added = 0;
      const failed = [];
      for (const t of weekTasks) {
        try {
          await addTaskToCalendar(token, t);
          added += 1;
        } catch (err) {
          failed.push(`${t.title}: ${err.message}`);
        }
      }
      if (added === 0 && failed.length) {
        setSyncMsg(failed[0]);
        setSyncState('error');
        return;
      }
      setSyncMsg(
        `Added ${added} of ${weekTasks.length} to your Google Calendar.${failed.length ? ' Some were skipped.' : ''}`
      );
      setSyncState('done');
    } catch (err) {
      setSyncMsg(err.message);
      setSyncState('error');
    }
  }

  if (busy) {
    return (
      <div className="glass-solid state-card fade-in">
        <p className="home-note">Loading your week…</p>
      </div>
    );
  }
  if (error && !plan) {
    return (
      <div className="glass-solid state-card fade-in">
        <p className="home-error">{error}</p>
      </div>
    );
  }

  return (
    <div className="cal fade-in">
      <div className="cal-head">
        <div>
          <h1 className="cal-title">This week</h1>
          <p className="cal-sub">At-risk tasks show in amber.</p>
        </div>
        <span className="cal-range">{rangeLabel}</span>
      </div>

      <div className="cal-week">
        {days.map((d) => {
          const key = ymd(d);
          const isToday = key === todayKey;
          const dayTasks = byDay[key] || [];
          const dateLabel =
            d.getDate() === 1 ? `${d.toLocaleDateString(undefined, { month: 'short' })} 1` : `${d.getDate()}`;
          return (
            <div key={key} className={`cal-day${isToday ? ' today' : ''}`}>
              <div className="cal-day-head">
                <div className="cal-day-wd">{WD[(d.getDay() + 6) % 7]}</div>
                <div className="cal-day-date">{dateLabel}</div>
              </div>
              <div className="cal-chips">
                {dayTasks.map((t) => (
                  <span key={t.id} className={`cal-chip ${RISK_CLASS(t.riskBand)}`}>
                    {t.title}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className={`cal-sync${syncState === 'done' ? ' done' : ''}`}
        onClick={sync}
        disabled={syncState === 'working' || syncState === 'done'}
      >
        {syncState === 'working'
          ? 'Syncing to your calendar…'
          : syncState === 'done'
          ? '✓ Synced to Google Calendar'
          : 'Sync to Google Calendar'}
      </button>
      {syncState === 'error' && <p className="cal-sync-err">{syncMsg}</p>}
      {syncState === 'done' && syncMsg && <p className="cal-sync-note">{syncMsg}</p>}
    </div>
  );
}
