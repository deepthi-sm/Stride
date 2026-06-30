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
const { parseTasks } = await import('./agent.js');

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
