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
const { parseTasks, breakDownTask, narrateRisk, runAction } = await import('./agent.js');
const { buildSchedule } = await import('./schedule.js');
const { assessRisk, assessTasks } = await import('./risk.js');
const { counterfactualPlan } = await import('./counterfactual.js');
const { startJob, getJob } = await import('./jobs.js');

// A task this size or larger is worth breaking into first steps.
const BIG_TASK_MINS = 120;

// Default to 8787 locally. 8080 is intentionally avoided because a local Jenkins
// (or other dev tool) commonly holds it. Cloud Run still injects PORT in prod.
const PORT = process.env.PORT || 8787;

// The built client lives at /client/dist, one level up from /server.
const CLIENT_DIST = join(__dirname, '..', 'client', 'dist');
const INDEX_HTML = join(CLIENT_DIST, 'index.html');

const app = express();
app.use(express.json());

// API routes go before the static and catch-all handlers.
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// GET /api/jobs/:id -> poll a background job started by one of the AI endpoints.
// While running it reports { status: 'running' }; when finished it returns the
// result (the same shape the endpoint used to return inline) or the error. The
// work runs to completion regardless of the client, so a tab that went inactive
// just collects the result here when it comes back.
app.get('/api/jobs/:id', async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'job not found or expired' });
    }
    if (job.status === 'done') {
      return res.json({ status: 'done', result: job.result });
    }
    if (job.status === 'error') {
      return res.json({ status: 'error', error: job.error });
    }
    res.json({ status: 'running' });
  } catch (err) {
    console.error('job read failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// The onboarding profile, validated against the six-question schema. Unknown or
// missing answers are dropped rather than trusted, so the rest of the engine
// (schedule, risk, action, rescue) only ever sees clean enum values.
const PROFILE_ENUMS = {
  role: ['student', 'professional', 'founder', 'other'],
  productivityWindow: ['early_morning', 'afternoon', 'evening', 'late_night', 'varies'],
  deadlineStyle: ['early', 'on_time', 'close', 'last_minute'],
  slips: ['deadlines', 'messages', 'bills', 'goals', 'none'],
  rescueStrategy: ['rebuild', 'protect', 'suggest_drop', 'draft_message'],
};
const SLOWDOWN_OPTIONS = ['underestimate', 'overwhelmed', 'distracted', 'avoid_starting', 'forgetful'];

// Build a clean Profile from raw answers. Returns { profile } on success or
// { error } when a required single-choice answer is missing or out of range.
function sanitizeProfile(raw) {
  if (!raw || typeof raw !== 'object') {
    return { error: 'profile must be an object of answers' };
  }
  const profile = {};
  for (const [field, allowed] of Object.entries(PROFILE_ENUMS)) {
    const value = raw[field];
    if (!allowed.includes(value)) {
      return { error: `${field} must be one of: ${allowed.join(', ')}` };
    }
    profile[field] = value;
  }
  // slowdowns is the one multi-select. Keep only known options, drop the rest,
  // and allow an empty list (the user may say nothing slows them down).
  const slowdowns = Array.isArray(raw.slowdowns) ? raw.slowdowns : [];
  profile.slowdowns = SLOWDOWN_OPTIONS.filter((opt) => slowdowns.includes(opt));
  return { profile };
}

// POST /api/profile { role, productivityWindow, deadlineStyle, slowdowns[],
// slips, rescueStrategy } -> validate, store, return the saved profile.
app.post('/api/profile', async (req, res) => {
  try {
    const { profile, error } = sanitizeProfile(req.body);
    if (error) {
      return res.status(400).json({ error });
    }
    await save('profile', profile);
    res.json(profile);
  } catch (err) {
    console.error('profile save failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/profile -> the stored profile, or null before onboarding is done.
app.get('/api/profile', async (req, res) => {
  try {
    res.json((await get('profile')) || null);
  } catch (err) {
    console.error('profile read failed:', err.message);
    res.status(500).json({ error: err.message });
  }
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

// POST /api/capture { text } -> start a background job that parses with Gemini
// and stores the tasks. Returns { jobId } at once; the job's result is the new
// tasks array (the same shape this used to return inline). The parse finishes on
// the server even if the tab goes inactive; the client polls /api/jobs/:id.
app.post('/api/capture', async (req, res) => {
  const text = (req.body?.text ?? '').toString().trim();
  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }
  try {
    const jobId = await startJob(async () => {
      const parsed = await parseTasks(text);
      const now = new Date().toISOString();
      const created = parsed.map((p) => toStoredTask(p, now));
      const existing = (await get('tasks')) || [];
      await save('tasks', existing.concat(created));
      return created;
    });
    res.status(202).json({ jobId });
  } catch (err) {
    console.error('capture failed to start:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/tasks -> the stored tasks.
app.get('/api/tasks', async (req, res) => {
  try {
    res.json((await get('tasks')) || []);
  } catch (err) {
    console.error('tasks read failed:', err.message);
    res.status(500).json({ error: err.message });
  }
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
    const tasks = (await get('tasks')) || [];
    const profile = await get('profile'); // may be null until onboarding is done
    const signals = await get('signals'); // may be null this early

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
      await save('tasks', tasks);
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

// POST /api/simulate { question } -> start a background job for the
// counterfactual. Returns { jobId } at once; the job's result is the same
// counterfactual object as before. An empty or missing question runs a system
// rescue using the profile's strategy. The Gemini work and recompute finish on
// the server even if the tab is backgrounded; the client polls /api/jobs/:id.
app.post('/api/simulate', async (req, res) => {
  try {
    const question = (req.body?.question ?? '').toString();
    const jobId = await startJob(async () => {
      const state = {
        tasks: (await get('tasks')) || [],
        profile: await get('profile'),
        signals: await get('signals'),
      };
      return counterfactualPlan(state, question);
    });
    res.status(202).json({ jobId });
  } catch (err) {
    console.error('simulate failed to start:', err.message);
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
    const tasks = (await get('tasks')) || [];
    const task = tasks.find((t) => t.id === req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'task not found' });
    }

    task.status = status;
    task.lastTouchedAt = new Date().toISOString();
    await save('tasks', tasks);

    // The status change itself is saved synchronously above. The rescue is the
    // slow part (Gemini plus recompute), so run it as a background job and hand
    // back its id. The rescue completes on the server even if the tab goes
    // inactive; the client polls /api/jobs/:id for it.
    if (status === 'slipping') {
      const rescueJobId = await startJob(async () =>
        counterfactualPlan(
          { tasks, profile: await get('profile'), signals: await get('signals') },
          '' // empty question triggers the rescue
        )
      );
      return res.json({ task, rescueJobId });
    }
    res.json({ task });
  } catch (err) {
    console.error('status update failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/:id/action -> start a background job that runs the Auto-Action
// Engine, stores the deliverable on the task, and returns { task, deliverableType,
// deliverable } (the same shape as before) as the job result. Returns { jobId }
// at once. The Gemini draft finishes on the server even if the tab is inactive;
// the client polls /api/jobs/:id.
app.post('/api/tasks/:id/action', async (req, res) => {
  try {
    const tasks = (await get('tasks')) || [];
    const task = tasks.find((t) => t.id === req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'task not found' });
    }

    const jobId = await startJob(async () => {
      const { deliverableType, deliverable } = await runAction(task, await get('profile'));
      task.deliverableType = deliverableType;
      task.deliverable = deliverable;
      task.lastTouchedAt = new Date().toISOString();
      await save('tasks', tasks);
      return { task, deliverableType, deliverable };
    });

    res.status(202).json({ jobId });
  } catch (err) {
    console.error('action failed to start:', err.message);
    res.status(502).json({ error: err.message });
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
