// The risk brain. assessRisk(state) is a transparent heuristic computed entirely
// in code, never a fake probability. Gemini is not called here; the plain
// language narration of bottlenecks and conflict chains is layered on at the
// route, so risk still works when Gemini is down.
//
// We reuse the schedule's time math (daysUntil, DAILY_FOCUS_MINS) so "free time
// before the deadline" means the same thing the planner uses.

import { buildSchedule, daysUntil, todayIso, DAILY_FOCUS_MINS } from './schedule.js';

// Factor weights, tuned from the suggested baseline in prompts/risk.md so a near
// deadline with high effort left reaches the high band on its own. They sum to 1.
const WEIGHTS = {
  urgency: 0.35,
  effortPressure: 0.35,
  dependencyPressure: 0.1,
  staleness: 0.1,
  patternPenalty: 0.1,
};

const URGENCY_HORIZON_DAYS = 7; // a deadline this far out carries no urgency
const STALE_HORIZON_DAYS = 7; // untouched this long is fully stale
const GHOST_STALE_DAYS = 3; // stale at or beyond this, with work left, is a ghost
const DEFAULT_EFFORT = 60;

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function band(score) {
  if (score >= 85) return 'critical';
  if (score >= 65) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

// Whole days since an ISO timestamp (lastTouchedAt), never negative.
function daysSince(iso, today) {
  if (!iso) return 0;
  const day = String(iso).slice(0, 10); // accept full timestamps or plain dates
  return Math.max(0, daysUntil(day, today));
}

// Effort still ahead of you. Done is zero; in_progress counts as half left.
function effortRemaining(task) {
  if (task.status === 'done') return 0;
  const est = task.estEffortMins || DEFAULT_EFFORT;
  return task.status === 'in_progress' ? Math.round(est / 2) : est;
}

// patternPenalty from the profile, 0-1. Neutral and small when there is no
// profile yet, so risk still works before onboarding.
function patternPenalty(task, profile) {
  if (!profile) return 0.2;
  const styleWeight = { last_minute: 0.6, close: 0.4, on_time: 0.1, early: 0 };
  let penalty = styleWeight[profile.deadlineStyle] ?? 0.2;

  const slowdowns = Array.isArray(profile.slowdowns) ? profile.slowdowns : [];
  const big = (task.estEffortMins || 0) >= 180;
  const notStarted = task.status === 'todo';
  const admin = ['bill', 'meeting', 'other'].includes(task.category);
  let add = 0;
  if (slowdowns.includes('overwhelmed') && big) add += 0.2;
  if (slowdowns.includes('avoid_starting') && notStarted) add += 0.2;
  if (slowdowns.includes('forgetful') && admin) add += 0.2;
  if (slowdowns.includes('underestimate')) add += 0.1;
  if (slowdowns.includes('distracted')) add += 0.1;

  return clamp01(penalty + Math.min(add, 0.4));
}

// Score one task and explain which factors drove it.
function scoreTask(task, ctx) {
  const { today, blockingCount } = ctx;

  const days = task.deadline ? daysUntil(today, task.deadline) : null;
  const remaining = effortRemaining(task);

  // urgency: due today or overdue is 1, far out fades to 0.
  const urgency =
    days === null ? 0 : clamp01(1 - Math.max(days, 0) / URGENCY_HORIZON_DAYS);

  // effortPressure: effort remaining vs free focus time before the deadline.
  // No time left but work remaining is full pressure.
  const freeMins = Math.max(days ?? URGENCY_HORIZON_DAYS, 0) * DAILY_FOCUS_MINS;
  let effortPressure;
  if (remaining <= 0) effortPressure = 0;
  else if (freeMins <= 0) effortPressure = 1;
  else effortPressure = clamp01(remaining / freeMins);

  const dependencyPressure = clamp01(blockingCount / 2);

  const stale = daysSince(task.lastTouchedAt, today);
  const staleness = clamp01(stale / STALE_HORIZON_DAYS);

  const pattern = patternPenalty(task, ctx.profile);

  const factors = {
    urgency,
    effortPressure,
    dependencyPressure,
    staleness,
    patternPenalty: pattern,
  };

  const score = Math.round(
    100 *
      (WEIGHTS.urgency * urgency +
        WEIGHTS.effortPressure * effortPressure +
        WEIGHTS.dependencyPressure * dependencyPressure +
        WEIGHTS.staleness * staleness +
        WEIGHTS.patternPenalty * pattern)
  );

  // Ghost Mode: drifting quietly, untouched a while with real work still left.
  const ghost = remaining > 0 && task.status !== 'done' && stale >= GHOST_STALE_DAYS;

  return {
    taskId: task.id,
    title: task.title,
    deadline: task.deadline,
    riskScore: score,
    riskBand: band(score),
    ghost,
    staleDays: stale,
    factors,
    remainingMins: remaining,
  };
}

// Per-task risk for the whole task set. Done tasks are skipped.
export function assessTasks(tasks, profile, signals) {
  const today = todayIso();
  const open = (Array.isArray(tasks) ? tasks : []).filter((t) => t && t.status !== 'done');

  // How many open tasks list this task as a dependency (it blocks them).
  const blocking = {};
  for (const t of open) {
    for (const dep of t.dependencies || []) {
      blocking[dep] = (blocking[dep] || 0) + 1;
    }
  }

  return open
    .map((task) =>
      scoreTask(task, {
        today,
        profile,
        blockingCount: blocking[task.title] || 0,
      })
    )
    .sort((a, b) => b.riskScore - a.riskScore);
}

function effortWords(mins) {
  if (!mins) return 'some work';
  if (mins < 60) return `${mins} minutes of work`;
  const h = Math.round((mins / 60) * 10) / 10;
  return h === 1 ? 'an hour of work' : `${h} hours of work`;
}

function whenWords(deadline, today) {
  if (!deadline) return 'no set deadline';
  const d = daysUntil(today, deadline);
  if (d < 0) return 'a passed deadline';
  if (d === 0) return 'a deadline today';
  if (d === 1) return 'a deadline tomorrow';
  return `a deadline in ${d} days`;
}

// Plain-language bottlenecks and conflict chains, computed in code. This is the
// transparent fallback; Gemini may rewrite it at the route for a warmer read.
function describe(perTask, tasks, today) {
  const bottlenecks = perTask
    .filter((t) => t.ghost || t.riskBand === 'high' || t.riskBand === 'critical')
    .slice(0, 3)
    .map((t) => {
      if (t.riskBand === 'high' || t.riskBand === 'critical') {
        return `${t.title} carries the most pressure, ${effortWords(t.remainingMins)} against ${whenWords(t.deadline, today)}.`;
      }
      return `${t.title} has gone untouched for ${t.staleDays} days with ${effortWords(t.remainingMins)} still left.`;
    });

  const conflictChains = [];

  // Time collisions: a day the planner has to give to more than one task.
  const { scheduledBlocks } = buildSchedule(tasks, null, null);
  const byDate = {};
  for (const b of scheduledBlocks) {
    (byDate[b.date] ||= new Set()).add(b.title);
  }
  for (const [date, titles] of Object.entries(byDate)) {
    const names = [...titles];
    if (names.length >= 2) {
      conflictChains.push(
        `On ${date}, ${names.slice(0, 2).join(' and ')} both need focus time.`
      );
    }
  }

  // Dependency chains: this task cannot start until that one is done.
  const open = tasks.filter((t) => t && t.status !== 'done');
  const titleDone = new Map(tasks.map((t) => [t.title, t.status === 'done']));
  for (const t of open) {
    for (const dep of t.dependencies || []) {
      if (titleDone.get(dep) === false) {
        conflictChains.push(`${dep} has to finish before ${t.title} can start.`);
      }
    }
  }

  return { bottlenecks, conflictChains: conflictChains.slice(0, 3) };
}

// Decide the single router trigger from the task set, in precedence order.
function pickTrigger(tasks, perTask) {
  const open = (Array.isArray(tasks) ? tasks : []).filter((t) => t && t.status !== 'done');
  if (open.some((t) => t.status === 'slipping')) return 'rescue';
  if (perTask.some((t) => t.ghost)) return 'ghost_mode';

  // simulate_ready when two or more tasks collide for the same focus day.
  const { scheduledBlocks } = buildSchedule(tasks, null, null);
  const dates = {};
  for (const b of scheduledBlocks) (dates[b.date] ||= new Set()).add(b.taskId);
  if (Object.values(dates).some((s) => s.size >= 2)) return 'simulate_ready';

  return 'none';
}

// assessRisk(state) -> { riskScore, riskBand, bottlenecks, conflictChains, trigger }
// state is { tasks, profile, signals }. The overall score is the worst task,
// because the whole plan is only as safe as its most fragile task.
export function assessRisk(state) {
  const tasks = state?.tasks || [];
  const profile = state?.profile || null;
  const signals = state?.signals || null;
  const today = todayIso();

  const perTask = assessTasks(tasks, profile, signals);
  const riskScore = perTask.length ? Math.max(...perTask.map((t) => t.riskScore)) : 0;
  const { bottlenecks, conflictChains } = describe(perTask, tasks, today);
  const trigger = pickTrigger(tasks, perTask);

  return {
    riskScore,
    riskBand: band(riskScore),
    bottlenecks,
    conflictChains,
    trigger,
  };
}
