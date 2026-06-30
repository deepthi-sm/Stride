import { useEffect, useState } from 'react';

const CATEGORY_LABEL = {
  assignment: 'Assignment',
  application: 'Application',
  bill: 'Bill',
  meeting: 'Meeting',
  other: 'Task',
};

function formatDeadline(deadline) {
  if (!deadline) return 'No deadline';
  const d = new Date(deadline + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return deadline;
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatEffort(mins) {
  if (!mins && mins !== 0) return null;
  if (mins < 60) return `${mins} min`;
  const h = Math.round((mins / 60) * 10) / 10;
  return `${h} hr`;
}

// Module 1 capture screen. Type a brain dump, Gemini parses it into tasks.
export default function Capture({ onCaptured }) {
  const [text, setText] = useState('');
  const [tasks, setTasks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Load anything already captured.
  useEffect(() => {
    fetch('/api/tasks')
      .then((r) => r.json())
      .then((data) => setTasks(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  async function capture(e) {
    e.preventDefault();
    const value = text.trim();
    if (!value || busy) return;

    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not capture that.');
      }
      const created = Array.isArray(data) ? data : [];
      // Newest on top.
      setTasks((prev) => [...created, ...prev]);
      setText('');
      if (onCaptured) onCaptured();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h1 className="wordmark">Stride</h1>
      <p className="prompt">What is on your plate?</p>

      <form className="capture" onSubmit={capture}>
        <textarea
          className="capture-box"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Dump it all here. Assignment due Friday, internship app tomorrow, pay rent Monday."
          rows={4}
        />
        <button className="capture-btn" type="submit" disabled={busy || !text.trim()}>
          {busy ? 'Reading…' : 'Capture'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {tasks.length > 0 && (
        <ul className="task-list">
          {tasks.map((t) => {
            const effort = formatEffort(t.estEffortMins);
            return (
              <li key={t.id} className="task">
                <div className="task-title">{t.title}</div>
                <div className="task-meta">
                  <span className="task-tag">{CATEGORY_LABEL[t.category] || 'Task'}</span>
                  <span>{formatDeadline(t.deadline)}</span>
                  {effort && <span>{effort}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
