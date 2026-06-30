import { useEffect, useState } from 'react';
import RescuePanel from './RescuePanel.jsx';
import TaskDetail from './TaskDetail.jsx';
import { runJob } from './api.js';

// The Home screen, restyled to the design. The data and behavior are unchanged:
// it still reads the whole plan from GET /api/plan, opens the real TaskDetail for
// any task, and runs the rescue through the existing POST /api/simulate path
// (empty question -> system rescue using the profile's strategy). Only the look
// changed.

// The plan is cached for the session so leaving Home and coming back does not
// refetch (each /api/plan call runs a slow server-side risk narration). A capture
// clears the cache through invalidatePlanCache so new tasks always show.
let planCache = null;
export function invalidatePlanCache() {
  planCache = null;
}

const RISK_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

function formatDeadline(deadline) {
  if (!deadline) return 'No deadline';
  const d = new Date(deadline + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return deadline;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function greetingFor() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const RISK_CLASS = (band) => (['low', 'medium', 'high', 'critical'].includes(band) ? band : 'low');

// Ghost mode is the calm amber flag for a stale-now-critical task; otherwise a
// high/critical or flagged task gets the "At risk" flag.
function TaskFlag({ task }) {
  if (task.ghost) return <span className="flag-ghost">Ghost mode</span>;
  if (task.atRisk || task.riskBand === 'high' || task.riskBand === 'critical') {
    return <span className="flag-risk">⚑ At risk</span>;
  }
  return null;
}

export default function Plan({ name }) {
  const [plan, setPlan] = useState(planCache);
  const [busy, setBusy] = useState(!planCache);
  const [error, setError] = useState('');
  const [rescue, setRescue] = useState(null);
  const [rescuing, setRescuing] = useState(false);
  const [detailTask, setDetailTask] = useState(null);

  async function loadPlan() {
    setBusy(true);
    try {
      const r = await fetch('/api/plan');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not build the plan.');
      planCache = data;
      setPlan(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Only fetch when there is nothing cached. A capture invalidates the cache, so
  // returning to Home after one still refreshes; a plain tab switch does not.
  useEffect(() => {
    if (!planCache) loadPlan();
  }, []);

  // Rescue my week: the system rescue (empty question) through the existing
  // simulate wiring. No task status is mutated; it just reads back the triage.
  async function runRescue() {
    if (rescuing) return;
    setRescuing(true);
    setError('');
    try {
      const result = await runJob('/api/simulate', { question: '' });
      setRescue(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setRescuing(false);
    }
  }

  function dismissRescue() {
    setRescue(null);
  }

  // Drilled into one task: the real TaskDetail (its own design pass comes later).
  if (detailTask) {
    return (
      <TaskDetail
        task={detailTask}
        onBack={(changed) => {
          setDetailTask(null);
          // A completed task leaves the active plan, so refresh only when changed.
          if (changed) loadPlan();
        }}
      />
    );
  }

  if (busy) {
    return (
      <div className="glass-solid state-card fade-in">
        <p className="home-note">Building your week…</p>
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

  const tasks = plan?.tasks ?? [];
  const hero = tasks[0] ?? null;
  const coming = tasks.slice(1);
  const tightLines = [
    ...(plan?.risk?.bottlenecks ?? []),
    ...(plan?.risk?.conflictChains ?? []),
  ];

  return (
    <div className="fade-in">
      <div className="home-head">
        <div>
          <div className="home-greeting">{greetingFor()}{name ? `, ${name}` : ''}</div>
          <h1 className="home-title">Here's your week</h1>
        </div>
        <button type="button" className="rescue-btn" onClick={runRescue} disabled={rescuing}>
          <span className="dot" />
          {rescuing ? 'Rescuing…' : 'Rescue my week'}
        </button>
      </div>

      {rescue && <RescuePanel result={rescue} onDismiss={dismissRescue} />}

      {tasks.length === 0 ? (
        <div className="glass-solid state-card">
          <p className="home-note">
            Nothing to plan yet. Add what's on your plate with the bar below and Stride will order it for you.
          </p>
        </div>
      ) : (
        <>
          {hero && (
            <section className="hero">
              <div className="hero-kicker"><span className="dot" />Right now</div>
              <h2 className="hero-title">{hero.title}</h2>
              <div className="hero-meta">
                <span className="hero-due">Due {formatDeadline(hero.deadline)}</span>
                {hero.nextStep && (
                  <>
                    <span className="hero-sep">·</span>
                    <span className="hero-note">{hero.nextStep}</span>
                  </>
                )}
              </div>
              <button type="button" className="start-btn" onClick={() => setDetailTask(hero)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7z" /></svg>
                Start now
              </button>
            </section>
          )}

          {tightLines.length > 0 && (
            <div className="tight">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="1.9">
                <path d="M12 3l9 16H3z" />
                <path d="M12 9v5M12 16.5v.5" />
              </svg>
              <div>
                <div className="tight-title">What's tight</div>
                <p className="tight-text">{tightLines.join(' ')}</p>
              </div>
            </div>
          )}

          {coming.length > 0 && (
            <>
              <div className="coming-head">
                <h3 className="coming-title">Coming up</h3>
                <span className="coming-count">{coming.length} tasks</span>
              </div>
              <div className="coming-list">
                {coming.map((t) => (
                  <button key={t.id} type="button" className="task-row" onClick={() => setDetailTask(t)}>
                    <span className={`risk-dot ${RISK_CLASS(t.riskBand)}`} />
                    <div className="task-row-body">
                      <div className="task-row-name">{t.title}</div>
                      <div className="task-row-meta">
                        <span className={`risk-chip ${RISK_CLASS(t.riskBand)}`}>{RISK_LABEL[t.riskBand] || 'Low'}</span>
                        <TaskFlag task={t} />
                        <span className="task-due">Due {formatDeadline(t.deadline)}</span>
                      </div>
                    </div>
                    <span className="task-row-chev">›</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
