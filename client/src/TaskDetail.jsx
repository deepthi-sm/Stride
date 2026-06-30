import { useEffect, useRef, useState } from 'react';
import { useCalendar } from './CalendarContext.jsx';
import { addTaskToCalendar } from './calendar.js';
import { runJob } from './api.js';

// The task detail screen, restyled to the design. The data and behavior are real:
//   - "Next steps" are the task's stored subtasks (broken down on the server).
//   - "Drafted by Stride" is the live Auto-Action Engine output, fetched through
//     the existing job path (POST /api/tasks/:id/action via runJob), editable in
//     place, copyable, and regenerable.
//   - "Add to my Google Calendar" writes a real event through the existing
//     calendar wiring and only flips to its confirmed state once the write lands.

const RISK_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const RISK_CLASS = (band) => (['low', 'medium', 'high', 'critical'].includes(band) ? band : 'low');

// Section heading for the deliverable, by type. The "Drafted by Stride" badge on
// the right stays constant; this is the left-hand label.
const DRAFT_LABEL = {
  draft_email: 'Drafted email',
  checklist: 'Drafted checklist',
  prep_doc: 'Drafted prep doc',
};

// Turn a raw backend error into a calm line. The free Gemini tier is small, so a
// quota error should read as a gentle limit, not a wall of JSON.
function friendlyError(msg) {
  if (/quota|RESOURCE_EXHAUSTED|429|rate.?limit|exceeded/i.test(msg || '')) {
    return "Stride has reached today's AI limit (the free Gemini tier allows 20 requests a day). Your next steps are ready above; the draft will come back once the limit resets.";
  }
  return msg || 'Something went wrong.';
}

// The "Next steps" checkboxes are a personal checklist, kept on the device per
// task so they survive leaving and reopening the task.
function stepsKey(id) {
  return `stride:steps:${id}`;
}
function readSteps(id) {
  try {
    return JSON.parse(localStorage.getItem(stepsKey(id))) || {};
  } catch {
    return {};
  }
}
function writeSteps(id, checked) {
  try {
    localStorage.setItem(stepsKey(id), JSON.stringify(checked));
  } catch {
    // ignore storage failures; the ticks just will not persist
  }
}

// "Due today, 5:00 PM" style. The day is relative when it is close; a real
// scheduled start time is appended when the plan placed one, otherwise just the
// day (no invented time).
function formatDue(task) {
  if (!task.deadline) return 'No deadline';
  const d = new Date(task.deadline + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return `Due ${task.deadline}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  let day;
  if (diff === 0) day = 'today';
  else if (diff === 1) day = 'tomorrow';
  else if (diff === -1) day = 'yesterday';
  else if (diff > 1 && diff < 7) day = d.toLocaleDateString(undefined, { weekday: 'long' });
  else day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  let time = '';
  if (typeof task.start === 'string' && /^\d{1,2}:\d{2}$/.test(task.start)) {
    const t = new Date(`${task.deadline}T${task.start}:00`);
    if (!Number.isNaN(t.getTime())) {
      time = `, ${t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    }
  }
  return `Due ${day}${time}`;
}

function CheckGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

// Copy the draft to the clipboard with a brief "Copied" confirmation.
function CopyDraftButton({ text }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button type="button" className="dd-pill" onClick={copy}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// The real calendar write, styled to the design. Flips to a confirmed state only
// after the event actually lands in the user's Google Calendar.
function AddToCalendar({ task }) {
  const { runWithToken } = useCalendar();
  const [state, setState] = useState('idle'); // idle | working | done | error
  const [msg, setMsg] = useState('');
  const [link, setLink] = useState('');

  async function add() {
    if (state === 'working' || state === 'done') return;
    setState('working');
    setMsg('');
    setLink('');
    try {
      const event = await runWithToken((token) => addTaskToCalendar(token, task));
      setLink(event?.htmlLink || '');
      setState('done');
    } catch (err) {
      setMsg(err.message);
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <div className="dd-cal-wrap">
        <div className="dd-cal done">
          <CheckGlyph />
          <span>Added to your Google Calendar</span>
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="dd-cal-link">
              View
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="dd-cal-wrap">
      <button type="button" className="dd-cal" onClick={add} disabled={state === 'working'}>
        {state === 'working' ? 'Adding to your calendar…' : 'Add to my Google Calendar'}
      </button>
      {state === 'error' && <p className="dd-cal-err">{msg}</p>}
    </div>
  );
}

export default function TaskDetail({ task, onBack }) {
  const [type, setType] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState(() => readSteps(task.id));
  const [completed, setCompleted] = useState(task.status === 'done');
  const [completing, setCompleting] = useState(false);
  const [completeErr, setCompleteErr] = useState('');
  // Whether we changed the task's status this visit, so the plan refreshes on back.
  const changed = useRef(false);

  const steps = Array.isArray(task.subtasks) ? task.subtasks : [];

  // Mark the task done (or undo it). Done tasks earn Momentum Points on the trail,
  // computed from real completions; this uses the existing status endpoint, so no
  // Gemini call and no server change.
  async function toggleComplete() {
    if (completing) return;
    const next = !completed;
    setCompleting(true);
    setCompleteErr('');
    try {
      const res = await fetch(`/api/tasks/${task.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next ? 'done' : 'todo' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not update the task.');
      setCompleted(next);
      changed.current = true;
    } catch (err) {
      setCompleteErr(friendlyError(err.message));
    } finally {
      setCompleting(false);
    }
  }

  // Generate a fresh draft (a real Gemini request). Used on first open and when
  // the user taps Regenerate.
  async function generate() {
    setBusy(true);
    setError('');
    try {
      // Runs as a backend job so the draft finishes even if the tab goes inactive.
      const data = await runJob(`/api/tasks/${task.id}/action`);
      setType(data.deliverableType);
      setText(data.deliverable);
    } catch (err) {
      setError(friendlyError(err.message));
    } finally {
      setBusy(false);
    }
  }

  // On open, reuse the draft the server already stored on this task so we do not
  // spend a Gemini request every time. Only generate when there is none yet.
  async function loadDraft() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/tasks');
      const all = await r.json();
      const stored = Array.isArray(all) ? all.find((t) => t.id === task.id) : null;
      if (stored && stored.deliverable) {
        setType(stored.deliverableType || '');
        setText(stored.deliverable);
        setBusy(false);
        return;
      }
      await generate();
    } catch (err) {
      setError(friendlyError(err.message));
      setBusy(false);
    }
  }

  useEffect(() => {
    loadDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  function toggleStep(i) {
    setChecked((c) => {
      const next = { ...c, [i]: !c[i] };
      writeSteps(task.id, next);
      return next;
    });
  }

  return (
    <div className="dd fade-in">
      <button type="button" className="dd-back" onClick={() => onBack(changed.current)}>
        ‹ Back
      </button>

      <div className="dd-head">
        <span className={`risk-chip ${RISK_CLASS(task.riskBand)}`}>{RISK_LABEL[task.riskBand] || 'Low'}</span>
        <span className="dd-due">{formatDue(task)}</span>
      </div>
      <h1 className="dd-title">{task.title}</h1>

      <button
        type="button"
        className={`dd-complete${completed ? ' done' : ''}`}
        onClick={toggleComplete}
        disabled={completing}
      >
        <span className="dd-complete-check">{completed && <CheckGlyph />}</span>
        <span className="dd-complete-label">
          {completing ? 'Saving…' : completed ? 'Completed' : 'Mark this task complete'}
        </span>
        {completed && <span className="dd-complete-note">Points added to your trail</span>}
      </button>
      {completeErr && <p className="dd-cal-err dd-complete-err">{completeErr}</p>}

      <h2 className="dd-section-label">Next steps</h2>
      {steps.length === 0 ? (
        <div className="glass dd-step-empty">
          <p className="home-note">Steps appear once Stride breaks this task down.</p>
        </div>
      ) : (
        <div className="dd-steps">
          {steps.map((step, i) => (
            <button
              key={i}
              type="button"
              className={`dd-step${checked[i] ? ' checked' : ''}`}
              onClick={() => toggleStep(i)}
            >
              <span className="dd-check" aria-hidden="true">{checked[i] && <CheckGlyph />}</span>
              <span className="dd-step-text">{step}</span>
            </button>
          ))}
        </div>
      )}

      <div className="dd-draft-head">
        <h2 className="dd-section-label flush">{DRAFT_LABEL[type] || 'Draft'}</h2>
        <span className="dd-stride-badge">
          <span className="dot" />
          Drafted by Stride
        </span>
      </div>

      <div className="dd-draft-panel">
        {busy ? (
          <p className="dd-draft-state">Drafting the first move…</p>
        ) : error ? (
          <div className="dd-draft-error">
            <p className="home-error">{error}</p>
            <button type="button" className="dd-pill" onClick={generate}>
              <RegenIcon />
              Try again
            </button>
          </div>
        ) : (
          <>
            <textarea
              className="dd-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              spellCheck={false}
            />
            <div className="dd-draft-actions">
              <CopyDraftButton text={text} />
              <button type="button" className="dd-pill" onClick={generate}>
                <RegenIcon />
                Regenerate
              </button>
            </div>
          </>
        )}
      </div>

      <AddToCalendar task={task} />
    </div>
  );
}

function RegenIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 11a8 8 0 10-2.3 5.7" />
      <path d="M20 4v6h-6" />
    </svg>
  );
}
