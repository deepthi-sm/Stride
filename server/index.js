// Stride server, walking skeleton.
// Loads .env first so process.env is populated before anything reads it.

import { config as loadEnv } from 'dotenv';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the project-root .env no matter which directory the process is launched
// from. Falls back to a .env sitting next to the server if present.
loadEnv({ path: join(__dirname, '..', '.env') });
loadEnv({ path: join(__dirname, '.env') });

const { get, save } = await import('./store.js');
const { parseTasks, breakDownTask, narrateRisk } = await import('./agent.js');
const { buildSchedule } = await import('./schedule.js');
const { assessRisk, assessTasks } = await import('./risk.js');
const { counterfactualPlan } = await import('./counterfactual.js');

// A task this size or larger is worth breaking into first steps.
const BIG_TASK_MINS = 120;

const PORT = process.env.PORT || 8080;

// The built client lives at /client/dist, one level up from /server.
const CLIENT_DIST = join(__dirname, '..', 'client', 'dist');
const INDEX_HTML = join(CLIENT_DIST, 'index.html');

const app = express();
app.use(express.json());

// API routes go before the static and catch-all handlers.
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Turn a parsed task (title, deadline, estEffortMins, dependencies, category)
// into a full stored Task with the fields the rest of the engine expects.
function toStoredTask(parsed, now) {
  return {
    id: randomUUID(),
    title: parsed.title,
    deadline: parsed.deadline ?? null,
    estEffortMins: parsed.estEffortMins ?? null,
    dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies : [],
    category: parsed.category || 'other',
    status: 'todo',
    subtasks: [],
    scheduledFor: null,
    priorityScore: null,
    lastTouchedAt: now,
    deliverable: null,
    deliverableType: null,
  };
}

// POST /api/capture { text } -> parse with Gemini, store, return the new tasks.
app.post('/api/capture', async (req, res) => {
  const text = (req.body?.text ?? '').toString().trim();
  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }
  try {
    const parsed = await parseTasks(text);
    const now = new Date().toISOString();
    const created = parsed.map((p) => toStoredTask(p, now));
    const existing = get('tasks') || [];
    save('tasks', existing.concat(created));
    res.json(created);
  } catch (err) {
    console.error('capture failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/tasks -> the stored tasks.
app.get('/api/tasks', (req, res) => {
  res.json(get('tasks') || []);
});

// Give a task its first steps if it does not have them yet. Subtasks are cached
// on the task so we only ask Gemini once. Returns true if the task changed.
async function ensureSteps(task) {
  if (Array.isArray(task.subtasks) && task.subtasks.length > 0) return false;
  try {
    const { subtasks } = await breakDownTask(task);
    if (subtasks.length) {
      task.subtasks = subtasks;
      return true;
    }
  } catch (err) {
    console.error('breakdown failed for', task.title, '-', err.message);
  }
  return false;
}

// Break down the tasks worth breaking down: every open big task, plus the single
// most urgent task so the highlighted next action always has a concrete step.
// If Gemini is unavailable the plan still works, a task just has no steps yet.
async function ensureSubtasks(tasks, topTaskId) {
  let mutated = false;
  for (const task of tasks) {
    if (task.status === 'done') continue;
    const big = (task.estEffortMins || 0) >= BIG_TASK_MINS;
    const isTop = task.id === topTaskId;
    if (!big && !isTop) continue;
    if (await ensureSteps(task)) mutated = true;
  }
  return mutated;
}

// GET /api/plan -> the current plan, built in code from the stored tasks.
// Returns one highlighted next action, the ordered task list with each task's
// next step, the plain-language tradeoffs, and the at-risk list.
app.get('/api/plan', async (req, res) => {
  try {
    const tasks = get('tasks') || [];
    const profile = get('profile'); // may be null until onboarding is done
    const signals = get('signals'); // may be null this early

    // The schedule is pure code and does not need subtasks, so build it first to
    // learn the order. The order tasks first appear in the schedule is the plan
    // order.
    const { scheduledBlocks, tradeoffs, atRisk } = buildSchedule(tasks, profile, signals);

    const orderIds = [];
    for (const b of scheduledBlocks) {
      if (!orderIds.includes(b.taskId)) orderIds.push(b.taskId);
    }

    // Now fill in first steps for the big tasks and the highlighted top action.
    if (await ensureSubtasks(tasks, orderIds[0])) {
      save('tasks', tasks);
    }

    const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
    const atRiskIds = new Set(atRisk.map((r) => r.taskId));

    // The risk brain: per-task band and Ghost Mode flag, plus the overall read.
    const perTask = assessTasks(tasks, profile, signals);
    const riskById = Object.fromEntries(perTask.map((r) => [r.taskId, r]));
    const risk = assessRisk({ tasks, profile, signals });

    // Let Gemini warm up the bottlenecks and conflict chains. Wrapped so risk
    // still works if it is down; we keep the code-computed text on any trouble.
    try {
      const narration = await narrateRisk({
        overall: { riskScore: risk.riskScore, riskBand: risk.riskBand, trigger: risk.trigger },
        tasks: perTask.map((r) => ({
          title: r.title,
          riskScore: r.riskScore,
          riskBand: r.riskBand,
          ghost: r.ghost,
          factors: r.factors,
        })),
        codeBottlenecks: risk.bottlenecks,
        codeConflictChains: risk.conflictChains,
      });
      if (narration.bottlenecks.length) risk.bottlenecks = narration.bottlenecks;
      if (narration.conflictChains.length) risk.conflictChains = narration.conflictChains;
    } catch (err) {
      console.error('risk narration failed, using code read -', err.message);
    }

    const orderedTasks = orderIds.map((id) => {
      const t = byId[id];
      const blocks = scheduledBlocks.filter((b) => b.taskId === id);
      const subtasks = Array.isArray(t.subtasks) ? t.subtasks : [];
      const nextStep = subtasks.length ? subtasks[0] : `Make a start on ${t.title}`;
      const r = riskById[id];
      return {
        id: t.id,
        title: t.title,
        deadline: t.deadline,
        estEffortMins: t.estEffortMins,
        category: t.category,
        status: t.status,
        scheduledFor: blocks[0]?.date ?? null,
        start: blocks[0]?.start ?? null,
        window: blocks[0]?.window ?? null,
        blocks,
        atRisk: atRiskIds.has(t.id),
        riskScore: r?.riskScore ?? 0,
        riskBand: r?.riskBand ?? 'low',
        ghost: r?.ghost ?? false,
        nextStep,
        subtasks,
      };
    });

    const top = orderedTasks[0] || null;
    const nextAction = top
      ? {
          taskId: top.id,
          title: top.title,
          nextStep: top.nextStep,
          scheduledFor: top.scheduledFor,
          start: top.start,
          window: top.window,
          atRisk: top.atRisk,
          riskBand: top.riskBand,
          ghost: top.ghost,
        }
      : null;

    res.json({
      generatedAt: new Date().toISOString(),
      nextAction,
      tasks: orderedTasks,
      tradeoffs,
      atRisk,
      risk,
      scheduledBlocks,
    });
  } catch (err) {
    console.error('plan failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/simulate { question } -> the counterfactual result. An empty or
// missing question runs a system rescue using the profile's strategy.
app.post('/api/simulate', async (req, res) => {
  try {
    const question = (req.body?.question ?? '').toString();
    const state = {
      tasks: get('tasks') || [],
      profile: get('profile'),
      signals: get('signals'),
    };
    const result = await counterfactualPlan(state, question);
    res.json(result);
  } catch (err) {
    console.error('simulate failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const TASK_STATUSES = new Set(['todo', 'in_progress', 'done', 'slipping']);

// POST /api/tasks/:id/status { status } -> update the task. When it becomes
// slipping, run the rescue and return it alongside the updated task.
app.post('/api/tasks/:id/status', async (req, res) => {
  try {
    const status = (req.body?.status ?? '').toString();
    if (!TASK_STATUSES.has(status)) {
      return res.status(400).json({ error: 'status must be todo, in_progress, done, or slipping' });
    }
    const tasks = get('tasks') || [];
    const task = tasks.find((t) => t.id === req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'task not found' });
    }

    task.status = status;
    task.lastTouchedAt = new Date().toISOString();
    save('tasks', tasks);

    if (status === 'slipping') {
      const result = await counterfactualPlan(
        { tasks, profile: get('profile'), signals: get('signals') },
        '' // empty question triggers the rescue
      );
      return res.json({ task, rescue: result });
    }
    res.json({ task });
  } catch (err) {
    console.error('status update failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Serve the built client.
app.use(express.static(CLIENT_DIST));

// Catch-all: any non-/api route returns index.html so client-side refresh works.
app.get(/^\/(?!api\/).*/, (req, res) => {
  if (existsSync(INDEX_HTML)) {
    res.sendFile(INDEX_HTML);
  } else {
    res
      .status(200)
      .type('text/plain')
      .send('Client not built yet. Run the client dev server, or build it: cd client && npm run build');
  }
});

app.listen(PORT, () => {
  console.log(`Stride server listening on http://localhost:${PORT}`);
});
