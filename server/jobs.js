// Background job registry. The heavy AI work (Gemini calls plus the recompute)
// runs here, detached from the HTTP request that started it. That is the whole
// point: once a job starts it runs to completion on the server no matter what the
// browser does. If the tab that asked for it is backgrounded, frozen, or its
// request is dropped, the work still finishes and the result waits here until the
// client polls for it.
//
// In-memory is fine for tonight's single local process. Swapping this for a
// shared store later is a change to this one file, like store.js.

import { randomUUID } from 'node:crypto';

const jobs = new Map();

// Hold a finished result long enough that a client returning to a long-inactive
// tab can still collect it.
const TTL_MS = 10 * 60 * 1000;

// Drop results that have been sitting finished past the TTL so the map does not
// grow without bound. Cheap to run on each new job.
function sweep() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > TTL_MS) {
      jobs.delete(id);
    }
  }
}

// Start running `run` (an async function) in the background and return its id at
// once. The promise is intentionally not awaited by the caller, so the request
// handler can respond immediately while the work continues here.
export function startJob(run) {
  const id = randomUUID();
  jobs.set(id, { status: 'running', result: null, error: null, finishedAt: null });

  Promise.resolve()
    .then(run)
    .then((result) => {
      jobs.set(id, { status: 'done', result, error: null, finishedAt: Date.now() });
    })
    .catch((err) => {
      console.error('job failed:', err.message);
      jobs.set(id, {
        status: 'error',
        result: null,
        error: err.message || 'The request failed.',
        finishedAt: Date.now(),
      });
    });

  sweep();
  return id;
}

// Snapshot of a job, or null if it is unknown or has expired.
export function getJob(id) {
  return jobs.get(id) || null;
}
