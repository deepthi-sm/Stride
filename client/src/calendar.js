// Google Calendar plumbing, frontend only. Two jobs:
//   1. Sign the user in with Google and return their OAuth access token.
//   2. Turn a Stride task into a real event and POST it to the user's calendar.
//
// The token is the user's own, obtained through Firebase. We call the Calendar
// REST API directly with it. No Gemini, no server, no stored secret.

import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from './firebase.js';

const CALENDAR_EVENTS_URL =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events';

// Open the Google popup, request the calendar scope, and pull out the access
// token. Returns { user, accessToken }.
export async function signInForCalendar() {
  const result = await signInWithPopup(auth, googleProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken;
  if (!accessToken) {
    throw new Error(
      'Google did not return a calendar access token. Make sure the calendar.events scope is granted on sign-in.'
    );
  }
  return { user: result.user, accessToken };
}

export async function signOutOfGoogle() {
  await signOut(auth);
}

// Work out a start and end time for a task's event.
//   - If the plan already scheduled the task, honor that block.
//   - Otherwise anchor the event to the deadline, ending at 5pm that day.
// The length is the estimated effort, defaulting to one hour when unknown.
// Returns { start, end } as Date objects, or null when the task has no date at
// all (nothing to put on a calendar).
function taskWindow(task) {
  const mins = Number(task.estEffortMins);
  const effort = Number.isFinite(mins) && mins > 0 ? mins : 60;

  if (task.scheduledFor) {
    const time = typeof task.start === 'string' && /^\d{1,2}:\d{2}$/.test(task.start) ? task.start : '09:00';
    const start = new Date(`${task.scheduledFor}T${time}:00`);
    if (!Number.isNaN(start.getTime())) {
      return { start, end: new Date(start.getTime() + effort * 60000) };
    }
  }

  if (task.deadline) {
    const end = new Date(`${task.deadline}T17:00:00`);
    if (!Number.isNaN(end.getTime())) {
      return { start: new Date(end.getTime() - effort * 60000), end };
    }
  }

  return null;
}

// Build the Calendar API event body from a task. Times are sent as full ISO
// instants plus the browser's time zone so the event lands at the right local
// time in the user's calendar.
export function buildEvent(task) {
  const win = taskWindow(task);
  if (!win) {
    throw new Error(`"${task.title}" has no deadline or scheduled time, so there is nothing to add to the calendar.`);
  }
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return {
    summary: task.title,
    description: 'Planned with Stride.',
    start: { dateTime: win.start.toISOString(), timeZone },
    end: { dateTime: win.end.toISOString(), timeZone },
    reminders: { useDefault: true },
  };
}

// Create one real event on the user's primary calendar. Returns the created
// event (which includes htmlLink). Throws with a readable message on failure; an
// expired token is flagged with code 'auth-expired' so callers can re-auth.
export async function addTaskToCalendar(accessToken, task) {
  const event = buildEvent(task);
  const res = await fetch(CALENDAR_EVENTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  });

  if (!res.ok) {
    if (res.status === 401) {
      const expired = new Error('Your Google session expired. Reconnecting…');
      expired.code = 'auth-expired';
      throw expired;
    }
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || '';
    } catch {
      // response was not JSON, fall through to the generic message
    }
    if (res.status === 403) {
      throw new Error(
        detail ||
          'Google refused the event. Check that the Google Calendar API is enabled and the calendar.events scope was granted.'
      );
    }
    throw new Error(detail || `Google Calendar rejected the event (HTTP ${res.status}).`);
  }

  return res.json();
}
