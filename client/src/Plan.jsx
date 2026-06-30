import { useEffect, useState } from 'react';
import RescuePanel from './RescuePanel.jsx';

const CATEGORY_LABEL = {
  assignment: 'Assignment',
  application: 'Application',
  bill: 'Bill',
  meeting: 'Meeting',
  other: 'Task',
};

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

// Today, tomorrow, or the weekday name. Keeps the hero line calm and human.
function whenLabel(iso, start) {
  if (!iso) return '';
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
  let day;
  if (iso === todayIso) day = 'today';
  else if (iso === tomorrow) day = 'tomorrow';
  else day = formatDate(iso);
  return start ? `${day} at ${start}` : day;
}

function formatDeadline(deadline) {
  if (!deadline) return 'No deadline';
  const d = new Date(deadline + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return deadline;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

const BAND_LABEL = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
  critical: 'Critical',
};

// A task is "hot" (gets the amber border) when the brain flags it stale via
// Ghost Mode or the risk band is high or critical.
function isHot(t) {
  return Boolean(t?.ghost) || t?.riskBand === 'high' || t?.riskBand === 'critical';
}

function RiskBand({ band }) {
  if (!band) return null;
  return <span className={`band band-${band}`}>{BAND_LABEL[band] || band}</span>;
}

// Ghost Mode: a calm amber flag for a task drifting untouched with work left.
function GhostFlag() {
  return <span className="ghost-flag">Ghost mode</span>;
}

// Module 2 plan screen. One highlighted next action, then the ordered list with
// each task's next step, then the tradeoffs in plain words.
export default function Plan() {
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [rescue, setRescue] = useState(null);
  const [slipId, setSlipId] = useState('');

  async function loadPlan() {
    setBusy(true);
    try {
      const r = await fetch('/api/plan');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not build the plan.');
      setPlan(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadPlan();
  }, []);

  // Tell Stride a task is slipping. It returns a rescue plan to surface up top.
  async function markSlipping(id) {
    if (slipId) return;
    setSlipId(id);
    setError('');
    try {
      const r = await fetch(`/api/tasks/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'slipping' }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not reach the rescue.');
      setRescue(data.rescue);
    } catch (err) {
      setError(err.message);
    } finally {
      setSlipId('');
    }
  }

  function dismissRescue() {
    setRescue(null);
    loadPlan(); // the slipping status changed the plan, so refresh it
  }

  if (busy) {
    return (
      <div className="panel">
        <p className="prompt">Building your plan…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel">
        <p className="error">{error}</p>
      </div>
    );
  }

  const tasks = plan?.tasks ?? [];
  const next = plan?.nextAction ?? null;

  if (tasks.length === 0) {
    return (
      <div className="panel">
        <h1 className="wordmark">Your plan</h1>
        <p className="plan-empty">Nothing to plan yet. Capture what is on your plate and Stride will order it for you.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h1 className="wordmark">Your plan</h1>

      {rescue && <RescuePanel result={rescue} onDismiss={dismissRescue} />}

      {next && (
        <section className={`next-action${isHot(next) ? ' at-risk' : ''}`}>
          <span className="next-label">Start here</span>
          <h2 className="next-title">{next.title}</h2>
          <p className="next-step">{next.nextStep}</p>
          <div className="next-flags">
            <RiskBand band={next.riskBand} />
            {next.ghost && <GhostFlag />}
          </div>
          {next.scheduledFor && (
            <p className="next-when">Planned for {whenLabel(next.scheduledFor, next.start)}</p>
          )}
        </section>
      )}

      <ol className="plan-list">
        {tasks.map((t, i) => (
          <li key={t.id} className={`plan-task${isHot(t) ? ' at-risk' : ''}`}>
            <div className="plan-task-head">
              <span className="plan-order">{i + 1}</span>
              <div className="plan-task-body">
                <div className="plan-task-title">
                  {t.title}
                  <RiskBand band={t.riskBand} />
                  {t.ghost && <GhostFlag />}
                </div>
                <div className="task-meta">
                  <span className="task-tag">{CATEGORY_LABEL[t.category] || 'Task'}</span>
                  <span>Due {formatDeadline(t.deadline)}</span>
                  {t.scheduledFor && <span>Planned {whenLabel(t.scheduledFor, t.start)}</span>}
                </div>
                <p className="plan-next-step">
                  <span className="plan-next-label">Next step</span> {t.nextStep}
                </p>
                <button
                  type="button"
                  className="slip-btn"
                  onClick={() => markSlipping(t.id)}
                  disabled={!!slipId}
                >
                  {slipId === t.id ? 'Reaching for a rescue…' : 'I am slipping on this'}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {(plan.risk?.bottlenecks?.length > 0 || plan.risk?.conflictChains?.length > 0) && (
        <section className="risk-read">
          <h3 className="section-title">What is tight</h3>
          <ul className="tradeoff-list">
            {plan.risk.bottlenecks.map((line, i) => (
              <li key={`b${i}`} className="tradeoff">{line}</li>
            ))}
            {plan.risk.conflictChains.map((line, i) => (
              <li key={`c${i}`} className="tradeoff">{line}</li>
            ))}
          </ul>
        </section>
      )}

      {plan.tradeoffs?.length > 0 && (
        <section className="tradeoffs">
          <h3 className="section-title">Why this order</h3>
          <ul className="tradeoff-list">
            {plan.tradeoffs.map((line, i) => (
              <li key={i} className="tradeoff">{line}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
