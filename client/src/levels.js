// Momentum Points (MP) and the 20-tier trail. Every number here is computed from
// the real stored task list (GET /api/tasks, the same tasks the rest of the app
// works with). Nothing is hardcoded or faked.
//
// What we can honestly measure from stored task data:
//   - A task finished (status 'done') before its deadline earns a base, scaled by
//     how early it landed (the time multiplier below).
//   - A heavy task earns the higher base in place of the lower one. "Heavy" uses
//     the same threshold the server calls a big task (estEffortMins >= 120), since
//     priorityScore is never populated by the backend (always null), so it is the
//     only real priority signal available. We REPLACE the 50 with 75 for these
//     (one consistent rule, not 50 + 75).
//   - An open task past its deadline costs points.
//
// What we deliberately do NOT compute, because the app keeps no daily history:
// streaks, "no overdue for N days", perfect weeks, collision survival, multi-day
// consistency. Those live only as each tier's descriptive "goal" text and never
// gate an unlock. The single gate is MP >= the tier threshold.

export const TIERS = [
  // Awakening
  { name: 'Wanderer', group: 'Awakening', mp: 0, goal: 'Just getting started' },
  { name: 'Seeker', group: 'Awakening', mp: 200, goal: '2-day streak' },
  { name: 'Pilgrim', group: 'Awakening', mp: 500, goal: '3-day streak' },
  { name: 'Climber', group: 'Awakening', mp: 900, goal: '5-day streak' },
  { name: 'Strider', group: 'Awakening', mp: 1500, goal: 'Clear a full week on time' },
  // Discipline
  { name: 'Keeper', group: 'Discipline', mp: 2200, goal: '7-day streak' },
  { name: 'Forger', group: 'Discipline', mp: 3200, goal: 'Two clean weeks' },
  { name: 'Sentinel', group: 'Discipline', mp: 4500, goal: 'No overdue for 10 days' },
  { name: 'Warden', group: 'Discipline', mp: 6000, goal: 'Protect a deadline under pressure' },
  { name: 'Vanguard', group: 'Discipline', mp: 8000, goal: 'Survive your first collision' },
  // Mastery
  { name: 'Ascendant', group: 'Mastery', mp: 11000, goal: '14-day streak' },
  { name: 'Aegis', group: 'Mastery', mp: 14500, goal: 'A month without a miss' },
  { name: 'Luminary', group: 'Mastery', mp: 18500, goal: 'Clear three heavy tasks early' },
  { name: 'Arbiter', group: 'Mastery', mp: 23000, goal: 'Win a rescue with room to spare' },
  { name: 'Sovereign', group: 'Mastery', mp: 28000, goal: '30-day streak' },
  // Transcendence
  { name: 'Paragon', group: 'Transcendence', mp: 34000, goal: 'A perfect month' },
  { name: 'Zenith', group: 'Transcendence', mp: 41000, goal: '60-day streak' },
  { name: 'Oracle', group: 'Transcendence', mp: 49000, goal: 'A full season on time' },
  { name: 'Eternal', group: 'Transcendence', mp: 58000, goal: '90-day streak' },
  { name: 'Astral', group: 'Transcendence', mp: 70000, goal: 'Never let a deadline collapse' },
];

export const GROUPS = ['Awakening', 'Discipline', 'Mastery', 'Transcendence'];

const BASE = 50;
const HEAVY_BASE = 75;
const HEAVY_EFFORT_MINS = 120; // mirrors the server's BIG_TASK_MINS
const OVERDUE_PENALTY = -50;

// A deadline is a date with no time; treat it as the end of that day so "before
// the deadline" and the hours-early buckets read naturally.
function deadlineInstant(deadline) {
  if (!deadline) return null;
  const d = new Date(`${deadline}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Reward finishing early: the earlier before the deadline, the larger the multiplier.
function timeMultiplier(hoursBefore) {
  if (hoursBefore > 48) return 2.0;
  if (hoursBefore >= 24) return 1.5;
  if (hoursBefore >= 6) return 1.2;
  return 1.0; // the final 6 hours
}

// Compute MP and a small honest breakdown from the real task list.
export function computeMomentum(tasks, now = new Date()) {
  const list = Array.isArray(tasks) ? tasks : [];
  let points = 0;
  let completedEarly = 0;
  let completedLate = 0;
  let overdue = 0;

  for (const t of list) {
    const deadline = deadlineInstant(t.deadline);
    if (t.status === 'done') {
      // Completion time proxy: the server sets lastTouchedAt to "now" the moment a
      // task flips to done (there is no dedicated completedAt field).
      const completedAt = t.lastTouchedAt ? new Date(t.lastTouchedAt) : null;
      const validCompletion = completedAt && !Number.isNaN(completedAt.getTime());
      if (deadline && validCompletion && completedAt <= deadline) {
        const hoursBefore = (deadline - completedAt) / 3600000;
        const heavy = Number(t.estEffortMins) >= HEAVY_EFFORT_MINS;
        const base = heavy ? HEAVY_BASE : BASE;
        points += Math.round(base * timeMultiplier(hoursBefore));
        completedEarly += 1;
      } else {
        // Done, but we cannot prove it landed before the deadline: no points.
        completedLate += 1;
      }
    } else if (deadline && deadline < now) {
      points += OVERDUE_PENALTY;
      overdue += 1;
    }
  }

  // MP never drops below zero, so the trail always starts at Wanderer.
  const mp = Math.max(0, points);
  return { mp, rawPoints: points, completedEarly, completedLate, overdue, total: list.length };
}

// The current tier index: the highest tier whose threshold MP meets or exceeds.
export function tierIndexForMp(mp) {
  let index = 0;
  for (let i = 0; i < TIERS.length; i += 1) {
    if (mp >= TIERS[i].mp) index = i;
    else break;
  }
  return index;
}

// Current tier, the next one, and progress toward it (all from real MP).
export function tierProgress(mp) {
  const index = tierIndexForMp(mp);
  const current = TIERS[index];
  const next = TIERS[index + 1] || null;
  const span = next ? next.mp - current.mp : 0;
  const into = mp - current.mp;
  const pct = next && span > 0 ? Math.max(0, Math.min(100, Math.round((into / span) * 100))) : 100;
  const toNext = next ? Math.max(0, next.mp - mp) : 0;
  return { index, current, next, pct, toNext, level: index + 1 };
}
