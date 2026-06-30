// Talking to the backend AI endpoints. These now run as background jobs: the
// POST starts the work and returns a job id, then we poll until it finishes. The
// heavy work (Gemini plus recompute) lives entirely on the server and runs to
// completion regardless of this tab. Nothing here is tied to the tab lifecycle,
// so switching tabs never cancels or abandons the work. When the user comes back,
// polling resumes and the stored result is shown.

// POST to start a job, then resolve to its result. Some endpoints return data
// inline (no jobId); those are passed straight through.
export async function runJob(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not start that.');
  if (!data.jobId) return data; // not a job, return the inline payload
  return pollJob(data.jobId);
}

// Poll a job by id until it finishes, then return its result (or throw its
// error). Safe to keep polling across a tab going inactive: the server holds a
// finished result for several minutes, so a tab that wakes up later still
// collects it. A throttled or frozen background tab just polls slowly, then
// catches up the moment it becomes visible again.
export async function pollJob(jobId, { intervalMs = 1500 } = {}) {
  for (;;) {
    const res = await fetch(`/api/jobs/${jobId}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Lost track of that request.');
    if (data.status === 'done') return data.result;
    if (data.status === 'error') throw new Error(data.error || 'That request failed.');
    await waitOrVisible(intervalMs);
  }
}

// Wait up to ms, but resolve early the moment the tab becomes visible again, so
// returning to the tab triggers an immediate poll instead of waiting out a
// background-throttled timer.
function waitOrVisible(ms) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      resolve();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') finish();
    };
    const timer = setTimeout(finish, ms);
    document.addEventListener('visibilitychange', onVisible);
  });
}
