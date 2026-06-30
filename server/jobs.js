// Background job registry, backed by Firestore. The heavy AI work (Gemini calls
// plus the recompute) runs detached from the HTTP request that started it, and
// its state lives in Firestore rather than process memory. That is what makes it
// safe on Cloud Run: an instance recycle, cold start, or a second instance no
// longer loses the job, so a poll to GET /api/jobs/:id can be served from any
// instance.
//
// Reuses the single Firestore client from store.js (same Application Default
// Credentials and the (default) database) — no second client, no new credentials.

import { randomUUID } from 'node:crypto';
import { db } from './store.js';

// One document per job in the 'jobs' collection. Shape:
//   { status: 'running' | 'done' | 'error', result?, error?, createdAt }
const jobs = db.collection('jobs');

// Start running `run` (an async function) in the background and return its id.
// startJob is async and awaits ONLY the create of the 'running' doc, so the doc
// is guaranteed to exist in Firestore before the id is returned — the client
// cannot poll faster than the create lands, which closes the first-poll race.
//
// The actual work is fire-and-forget: run() is NOT awaited, so the POST handler
// responds 202 { jobId } in milliseconds while Gemini and the recompute continue.
// On settle the same doc is updated to 'done' (with result) or 'error' (with
// message); update (not set) so the original createdAt is preserved.
export async function startJob(run) {
  const id = randomUUID();
  const ref = jobs.doc(id);

  // The only awaited write: the running doc must exist before we return the id.
  await ref.set({ status: 'running', createdAt: new Date() });

  // Fire-and-forget the work. Promise.resolve().then(run) so even a synchronous
  // throw inside run becomes a rejection and lands as an 'error' job.
  Promise.resolve()
    .then(run)
    .then((result) => ref.update({ status: 'done', result: result ?? null }))
    .catch((err) => {
      console.error('job failed:', err.message);
      return ref.update({ status: 'error', error: err.message || 'The request failed.' });
    })
    .catch((err) => {
      // The outcome write itself failed; only logging is left to do.
      console.error('job write failed:', err.message);
    });

  return id;
}

// getJob(id) -> the stored job ({ status, result?, error?, createdAt }) or null
// when no such document exists. Async, since it reads from Firestore; the
// GET /api/jobs/:id handler awaits it.
export async function getJob(id) {
  const snapshot = await jobs.doc(id).get();
  if (!snapshot.exists) return null;
  return snapshot.data();
}
