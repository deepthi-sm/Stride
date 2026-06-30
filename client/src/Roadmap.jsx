import { useEffect, useState } from 'react';
import { TIERS, computeMomentum, tierProgress } from './levels.js';

// The gamification trail. It reads the SAME real task list the rest of the app
// stores (GET /api/tasks, which unlike /api/plan keeps completed tasks), computes
// Momentum Points from those tasks in levels.js, and shows where the user stands
// on the 20-tier path. MP is the only thing that unlocks a tier; the per-tier goal
// line is descriptive flavor, never a gate. See levels.js for the honest rules.

export default function Roadmap() {
  const [tasks, setTasks] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/tasks');
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Could not load your trail.');
        if (!cancelled) setTasks(Array.isArray(data) ? data : []);
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

  if (busy) {
    return (
      <div className="glass-solid state-card fade-in">
        <p className="home-note">Reading your progress…</p>
      </div>
    );
  }
  if (error && !tasks) {
    return (
      <div className="glass-solid state-card fade-in">
        <p className="home-error">{error}</p>
      </div>
    );
  }

  const list = tasks || [];
  const { mp, completedEarly, overdue } = computeMomentum(list);
  const { index, current, next, pct, toNext, level } = tierProgress(mp);
  const fresh = completedEarly === 0;

  return (
    <div className="rm fade-in">
      <div className="rm-head">
        <div>
          <h1 className="rm-title">Your trail</h1>
          <p className="rm-sub">
            Level {level} · {current.name}
            <span className="rm-group"> · {current.group}</span>
          </p>
        </div>
        <div className="rm-points">
          <span className="rm-points-num">{mp.toLocaleString()}</span>
          <span className="rm-points-label">points</span>
        </div>
      </div>

      <div className="rm-progress glass-solid">
        <div className="rm-progress-head">
          <span className="rm-progress-title">{next ? `Progress to ${next.name}` : 'Top of the trail'}</span>
          {next && <span className="rm-progress-pct">{pct}%</span>}
        </div>
        <div className="rm-bar">
          <div className="rm-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="rm-progress-note">
          {fresh
            ? 'Finish a task before its deadline to earn your first points.'
            : next
            ? `${toNext.toLocaleString()} MP to ${next.name}.`
            : 'You have reached Astral, the final tier.'}
          {completedEarly > 0 && (
            <>
              {' '}
              {completedEarly} finished early
              {overdue > 0 ? `, ${overdue} past deadline.` : '.'}
            </>
          )}
        </p>
      </div>

      <p className="rm-flavor">Points are what unlock a tier. The streak goals show the longer vision.</p>

      <div className="rm-trail">
        {TIERS.map((tier, i) => {
          const state = i < index ? 'done' : i === index ? 'current' : 'locked';
          const first = i === 0 || TIERS[i - 1].group !== tier.group;
          return (
            <div key={tier.name}>
              {first && <div className="rm-group-head">{tier.group}</div>}
              <div className={`rm-tier ${state}`}>
                <div className="rm-node-col">
                  <div className="rm-node">{state === 'locked' ? <LockGlyph /> : i + 1}</div>
                </div>
                <div className="rm-tier-body">
                  <div className="rm-tier-top">
                    <span className="rm-tier-name">{tier.name}</span>
                    <span className="rm-tier-meta">
                      <span className="rm-tier-mp">{tier.mp.toLocaleString()} MP</span>
                      <span className={`rm-tier-badge ${state}`}>
                        {state === 'done' ? 'Unlocked' : state === 'current' ? 'You are here' : 'Locked'}
                      </span>
                    </span>
                  </div>
                  <div className="rm-tier-goal">Goal: {tier.goal}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  );
}
