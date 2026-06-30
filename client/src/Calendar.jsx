import { useEffect, useState } from 'react';
import { useCalendar } from './CalendarContext.jsx';
import { addTaskToCalendar } from './calendar.js';

// The calendar view. Real tasks come from the same GET /api/plan the rest of the
// app reads, placed on their due dates in a 7-column grid that grows to as many
// weeks as the tasks need: a task two weeks out simply lands on a later row.
// Chips are colored by risk band, so at-risk (high/critical) tasks read amber.
// "Sync to Google Calendar" writes every placed task through the existing
// calendar wiring; once it lands, the button is gone for good.

const RISK_CLASS = (band) => (['low', 'medium', 'high', 'critical'].includes(band) ? band : 'low');
const WD = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MAX_WEEKS = 12; // a sane ceiling so a far-future task cannot draw a huge grid
const SYNCED_KEY = 'stride:calendarSynced';

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
function parseDeadline(s) {
  const d = new Date(s + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function Calendar() {
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const { ensureToken } = useCalendar();
  const [syncState, setSyncState] = useState('idle'); // idle | working | error
  const [syncMsg, setSyncMsg] = useState('');
  // Once the week's tasks are in Google Calendar we hide the button for good.
  const [synced, setSynced] = useState(() => {
    try {
      return localStorage.getItem(SYNCED_KEY) === '1';
    } catch {
      return false;
    }
  });

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
  today.setHours(0, 0, 0, 0);
  const todayKey = ymd(today);

  const tasks = plan?.tasks ?? [];
  const placed = tasks.filter((t) => parseDeadline(t.deadline)); // tasks that can sit on a date
  const byDay = {};
  for (const t of placed) {
    (byDay[t.deadline] = byDay[t.deadline] || []).push(t);
  }

  // The grid spans from the start of the earliest relevant week to the end of the
  // latest, so today and every task are always visible. It grows by whole weeks.
  const dates = placed.map((t) => parseDeadline(t.deadline));
  const minDate = dates.reduce((m, d) => (d < m ? d : m), today);
  const maxDate = dates.reduce((m, d) => (d > m ? d : m), today);
  const gridStart = startOfWeek(minDate);
  const lastWeekStart = startOfWeek(maxDate);
  let weeks = Math.round((lastWeekStart - gridStart) / (7 * 86400000)) + 1;
  weeks = Math.max(1, Math.min(MAX_WEEKS, weeks));
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));

  const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const rangeLabel = `${fmt(gridStart)} – ${fmt(days[days.length - 1])}`;
  const heading = weeks > 1 ? 'The weeks ahead' : 'This week';

  async function sync() {
    if (syncState === 'working' || synced) return;
    if (!placed.length) {
      setSyncMsg('No dated tasks to sync yet.');
      setSyncState('error');
      return;
    }
    setSyncState('working');
    setSyncMsg('');
    try {
      const token = await ensureToken();
      let added = 0;
      const failed = [];
      for (const t of placed) {
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
        `Added ${added} of ${placed.length} to your Google Calendar.${failed.length ? ' Some were skipped.' : ''}`
      );
      setSyncState('idle');
      setSynced(true);
      try {
        localStorage.setItem(SYNCED_KEY, '1');
      } catch {
        // ignore storage failures; the button still hides for this session
      }
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
          <h1 className="cal-title">{heading}</h1>
          <p className="cal-sub">At-risk tasks show in amber.</p>
        </div>
        <span className="cal-range">{rangeLabel}</span>
      </div>

      <div className="cal-weekdays">
        {WD.map((w) => (
          <div key={w} className="cal-wd-head">{w}</div>
        ))}
      </div>

      <div className="cal-cells">
        {days.map((d) => {
          const key = ymd(d);
          const isToday = key === todayKey;
          const dayTasks = byDay[key] || [];
          const dateLabel =
            d.getDate() === 1 ? `${d.toLocaleDateString(undefined, { month: 'short' })} 1` : `${d.getDate()}`;
          return (
            <div key={key} className={`cal-day${isToday ? ' today' : ''}`}>
              <div className="cal-day-head">
                <span className="cal-day-wd">{WD[(d.getDay() + 6) % 7]}</span>
                <span className="cal-day-date">{dateLabel}</span>
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

      {synced ? (
        <p className="cal-synced-note">
          <span className="cal-synced-dot" />
          Synced to Google Calendar
        </p>
      ) : (
        <>
          <button
            type="button"
            className="cal-sync"
            onClick={sync}
            disabled={syncState === 'working'}
          >
            {syncState === 'working' ? 'Syncing to your calendar…' : 'Sync to Google Calendar'}
          </button>
          {syncState === 'error' && <p className="cal-sync-err">{syncMsg}</p>}
        </>
      )}
    </div>
  );
}
