// The counterfactual engine: one core, two triggers.
//   - A free-form what-if (question present) becomes concrete changes, applied
//     to a copy of the task graph, then recomputed and narrated.
//   - An empty question is a system rescue driven by profile.rescueStrategy.
//
// Gemini does two jobs only: read the what-if (Half A) and narrate (Half B).
// Everything in between is transparent code, and every Gemini call is wrapped so
// a failure degrades to a code-computed result instead of breaking.

import { buildSchedule, addDays } from './schedule.js';
import { assessRisk } from './risk.js';
import { proposeChanges, narrateCounterfactual, rescueGuidance } from './agent.js';

const BAND_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

function cloneTasks(tasks) {
  return (tasks || []).map((t) => ({
    ...t,
    dependencies: [...(t.dependencies || [])],
    subtasks: [...(t.subtasks || [])],
  }));
}

// Match a task by exact title first, then a loose contains, so the model does
// not have to reproduce punctuation perfectly.
function findByTitle(tasks, title) {
  if (!title) return null;
  const lower = String(title).toLowerCase().trim();
  return (
    tasks.find((t) => t.title.toLowerCase() === lower) ||
    tasks.find((t) => t.title.toLowerCase().includes(lower)) ||
    null
  );
}

// Apply changes to a COPY of the task graph. Never mutates the input.
export function applyChanges(tasks, changes) {
  let next = cloneTasks(tasks);
  for (const c of changes || []) {
    const value = Number.isFinite(c.value) ? c.value : 0;
    if (c.type === 'remove') {
      const target = findByTitle(next, c.targetTitle);
      if (target) next = next.filter((t) => t.id !== target.id);
      continue;
    }
    const target = findByTitle(next, c.targetTitle);
    if (!target) continue;
    if (c.type === 'delay_days') {
      if (target.deadline) target.deadline = addDays(target.deadline, value);
    } else if (c.type === 'set_effort_mins') {
      target.estEffortMins = Math.max(0, value);
    } else if (c.type === 'move_last') {
      // Push it just past the latest deadline so the planner sequences it last.
      const deadlines = next.map((t) => t.deadline).filter(Boolean).sort();
      const latest = deadlines[deadlines.length - 1];
      if (latest) target.deadline = addDays(latest, 1);
    }
  }
  return next;
}

// A compact view of when each task is scheduled to finish, used for the cascade.
function scheduleView(tasks, profile, signals) {
  const sched = buildSchedule(tasks, profile, signals);
  const finish = {};
  const order = [];
  const seen = new Set();
  for (const b of sched.scheduledBlocks) {
    finish[b.taskId] = b.date; // last block wins, so this ends as the finish date
    if (!seen.has(b.taskId)) {
      seen.add(b.taskId);
      order.push(b.taskId);
    }
  }
  return { sched, finish, order };
}

function summarize(tasks, profile, signals) {
  const { sched, finish, order } = scheduleView(tasks, profile, signals);
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const risk = assessRisk({ tasks, profile, signals });
  return {
    order: order.map((id) => ({
      title: byId[id]?.title,
      deadline: byId[id]?.deadline ?? null,
      finishesOn: finish[id] ?? null,
    })),
    riskBand: risk.riskBand,
    atRisk: sched.atRisk.map((r) => r.title),
  };
}

// A plain-language cascade computed in code, used as the fallback when Gemini is
// down and to backstop an empty narration.
function codeCascade(beforeTasks, afterTasks, profile, signals) {
  const b = scheduleView(beforeTasks, profile, signals);
  const a = scheduleView(afterTasks, profile, signals);
  const beforeRisk = new Set(b.sched.atRisk.map((r) => r.taskId));
  const lines = [];

  for (const t of afterTasks) {
    const fb = b.finish[t.id];
    const fa = a.finish[t.id];
    if (fb && fa && fa > fb) {
      lines.push(`${t.title} now wraps up on ${fa} instead of ${fb}.`);
    }
  }
  for (const r of a.sched.atRisk) {
    if (!beforeRisk.has(r.taskId)) {
      lines.push(`${r.title} no longer fits before its deadline.`);
    }
  }
  for (const t of beforeTasks) {
    if (!afterTasks.find((x) => x.id === t.id)) {
      lines.push(`${t.title} is dropped, which frees its time for the rest.`);
    }
  }
  if (!lines.length) lines.push('Nothing downstream shifts much, the rest of the plan holds.');
  return lines.slice(0, 4);
}

function bandDirectionRec(beforeTasks, afterTasks, profile, signals) {
  const rb = assessRisk({ tasks: beforeTasks, profile, signals }).riskBand;
  const ra = assessRisk({ tasks: afterTasks, profile, signals }).riskBand;
  if (BAND_RANK[ra] > BAND_RANK[rb]) {
    return `This pushes overall risk up to ${ra}. Hold the original plan unless you really need the change.`;
  }
  if (BAND_RANK[ra] < BAND_RANK[rb]) {
    return `This eases overall risk to ${ra}. It is a safe move if you want the room.`;
  }
  return `Overall risk stays ${ra}. The change is workable either way.`;
}

// --- the what-if path ---

async function simulate(tasks, profile, signals, question) {
  let changes = [];
  try {
    changes = await proposeChanges(tasks, question);
  } catch (err) {
    console.error('proposeChanges failed, no changes applied -', err.message);
  }

  const after = applyChanges(tasks, changes);
  const newRiskBand = assessRisk({ tasks: after, profile, signals }).riskBand;

  const context = {
    question,
    changes,
    before: summarize(tasks, profile, signals),
    after: summarize(after, profile, signals),
  };

  let cascade = [];
  let recommendation = '';
  try {
    const narration = await narrateCounterfactual(context);
    cascade = narration.cascade;
    recommendation = narration.recommendation;
  } catch (err) {
    console.error('narrateCounterfactual failed, using code read -', err.message);
  }
  if (!cascade.length) cascade = codeCascade(tasks, after, profile, signals);
  if (!recommendation) recommendation = bandDirectionRec(tasks, after, profile, signals);

  return { changes, cascade, newRiskBand, recommendation };
}

// --- the rescue path ---

function draftMessage(task) {
  const when = task?.deadline ? `the ${task.deadline} deadline` : 'a tight deadline';
  const title = task?.title || 'this work';
  return (
    `Hi,\n\n` +
    `I wanted to flag early that ${title} is running tight against ${when}. ` +
    `Could I have a short extension of two days? That would let me hand it over in good shape.\n\n` +
    `Thank you for understanding.`
  );
}

function rescueFallbackRec(strategy, protect, drop) {
  switch (strategy) {
    case 'protect':
      return `Protect ${protect?.title || 'your top task'} and let the lower ones wait. Give it your next focus block.`;
    case 'suggest_drop':
      return `Drop ${drop?.title || 'the least important task'} to save the rest. You can pick it back up once you are clear.`;
    case 'draft_message':
      return `Send the drafted message to buy two days on ${protect?.title || 'the task at risk'}, then keep moving on the rest.`;
    case 'rebuild':
    default:
      return `Rebuild from now: put ${protect?.title || 'your most urgent task'} first and reflow the rest into the time you have.`;
  }
}

async function rescue(tasks, profile, signals) {
  const strategy = profile?.rescueStrategy || 'rebuild';
  const open = (tasks || []).filter((t) => t && t.status !== 'done');

  // Order open tasks the way the planner would: most urgent first.
  const { order } = scheduleView(open, profile, signals);
  const byId = Object.fromEntries(open.map((t) => [t.id, t]));
  const ordered = order.length ? order.map((id) => byId[id]) : open;

  const slipping = open.filter((t) => t.status === 'slipping');
  const threatened = slipping[0] || ordered[0] || null;
  const protect = ordered[0] || null;
  const drop = ordered.length > 1 ? ordered[ordered.length - 1] : null;

  // The concrete move the rescue makes, so the after-state and band are real.
  let changes = [];
  let message = null;
  if (strategy === 'suggest_drop' && drop) {
    changes = [{ type: 'remove', targetTitle: drop.title, value: 0 }];
  } else if (strategy === 'protect' && drop) {
    changes = [{ type: 'move_last', targetTitle: drop.title, value: 0 }];
  } else if (strategy === 'draft_message' && threatened) {
    changes = [{ type: 'delay_days', targetTitle: threatened.title, value: 2 }];
    message = draftMessage(threatened);
  }

  const after = applyChanges(tasks, changes);
  const newRiskBand = assessRisk({ tasks: after, profile, signals }).riskBand;

  const context = {
    mode: 'rescue',
    strategy,
    protect: protect?.title || null,
    drop: drop?.title || null,
    threatened: threatened?.title || null,
    changes,
    draftedMessage: message,
    before: summarize(tasks, profile, signals),
    after: summarize(after, profile, signals),
  };
  const guidance = `${rescueGuidance()}\n\nFor this rescue the strategy is ${strategy}. Protect ${protect?.title || 'the most urgent task'}${drop ? `, and the task to drop or defer is ${drop.title}` : ''}.`;

  let cascade = [];
  let recommendation = '';
  try {
    const narration = await narrateCounterfactual(context, guidance);
    cascade = narration.cascade;
    recommendation = narration.recommendation;
  } catch (err) {
    console.error('rescue narration failed, using code read -', err.message);
  }
  if (!cascade.length) cascade = codeCascade(tasks, after, profile, signals);
  if (!recommendation) recommendation = rescueFallbackRec(strategy, protect, drop);

  const brief = (t) => (t ? { id: t.id, title: t.title, deadline: t.deadline ?? null } : null);

  return {
    changes,
    cascade,
    newRiskBand,
    recommendation,
    rescue: {
      strategy,
      protect: brief(protect),
      drop: brief(drop),
      threatened: brief(threatened),
      message,
    },
  };
}

// counterfactualPlan(state, question)
//   -> { changes, cascade, newRiskBand, recommendation }  (plus a rescue object
//      when the question is empty). state is { tasks, profile, signals }.
export async function counterfactualPlan(state, question) {
  const tasks = state?.tasks || [];
  const profile = state?.profile || null;
  const signals = state?.signals || null;
  const q = (question || '').toString().trim();

  return q ? simulate(tasks, profile, signals, q) : rescue(tasks, profile, signals);
}
