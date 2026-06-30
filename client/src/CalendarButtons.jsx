// The calendar UI: a sign-in entry point, a per-task "add" button, and a
// "sync the whole plan" button. All three lean on useCalendar() for the token.

import { useState } from 'react';
import { useCalendar } from './CalendarContext.jsx';
import { addTaskToCalendar } from './calendar.js';

// The sign-in entry point. Sits under the nav: connect when signed out, or show
// who is connected with a quiet disconnect link when signed in.
export function CalendarStatus() {
  const { user, accessToken, busy, error, connect, disconnect } = useCalendar();

  if (user && accessToken) {
    return (
      <div className="cal-status">
        <span className="cal-status-on">Calendar connected</span>
        {user.email && <span className="cal-status-email">{user.email}</span>}
        <button type="button" className="cal-status-link" onClick={disconnect}>
          Disconnect
        </button>
      </div>
    );
  }

  // Signed in to Firebase from a previous load but no live token this session.
  const label = user ? 'Reconnect Google Calendar' : 'Connect Google Calendar';

  return (
    <div className="cal-status">
      <button type="button" className="cal-connect" onClick={connect} disabled={busy}>
        {busy ? 'Opening Google…' : label}
      </button>
      {error && <span className="cal-status-error">{error}</span>}
    </div>
  );
}

// One task -> one real event. Confirms with a link to the created event.
export function AddToCalendarButton({ task }) {
  const { runWithToken } = useCalendar();
  const [state, setState] = useState('idle'); // idle | working | done | error
  const [msg, setMsg] = useState('');
  const [link, setLink] = useState('');

  async function add() {
    setState('working');
    setMsg('');
    setLink('');
    try {
      const event = await runWithToken((token) => addTaskToCalendar(token, task));
      setState('done');
      setMsg('Added to your Google Calendar');
      setLink(event?.htmlLink || '');
    } catch (err) {
      setState('error');
      setMsg(err.message);
    }
  }

  return (
    <span className="cal-add-wrap">
      <button
        type="button"
        className="cal-add-btn"
        onClick={add}
        disabled={state === 'working'}
      >
        {state === 'working' ? 'Adding…' : 'Add to my Google Calendar'}
      </button>
      {state === 'done' && (
        <span className="cal-add-ok">
          {msg}
          {link && (
            <>
              {' '}
              <a href={link} target="_blank" rel="noreferrer" className="cal-add-link">
                View
              </a>
            </>
          )}
        </span>
      )}
      {state === 'error' && <span className="cal-add-err">{msg}</span>}
    </span>
  );
}

// The whole plan -> events, one per task. Reports how many landed and lists any
// that did not (for example a task with no deadline).
export function SyncPlanButton({ tasks }) {
  const { ensureToken } = useCalendar();
  const [state, setState] = useState('idle'); // idle | working | done | error
  const [msg, setMsg] = useState('');
  const [failures, setFailures] = useState([]);

  async function sync() {
    if (!tasks || tasks.length === 0) return;
    setState('working');
    setMsg('');
    setFailures([]);
    try {
      const token = await ensureToken();
      let added = 0;
      const failed = [];
      for (const task of tasks) {
        try {
          await addTaskToCalendar(token, task);
          added += 1;
        } catch (err) {
          failed.push(`${task.title}: ${err.message}`);
        }
      }
      setState('done');
      setMsg(`Added ${added} of ${tasks.length} to your Google Calendar.`);
      setFailures(failed);
    } catch (err) {
      setState('error');
      setMsg(err.message);
    }
  }

  return (
    <div className="cal-sync">
      <button
        type="button"
        className="cal-sync-btn"
        onClick={sync}
        disabled={state === 'working' || !tasks || tasks.length === 0}
      >
        {state === 'working' ? 'Syncing your plan…' : 'Sync my plan to Google Calendar'}
      </button>
      {state === 'done' && <p className="cal-sync-ok">{msg}</p>}
      {state === 'error' && <p className="cal-sync-err">{msg}</p>}
      {failures.length > 0 && (
        <ul className="cal-sync-skipped">
          {failures.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
