// One small context so any screen can reach the Google Calendar connection: who
// is signed in, the current access token, and the actions to connect, disconnect,
// and run a calendar call (re-authing once if the token has expired).
//
// Wrap the app in <CalendarProvider> (see main.jsx), then call useCalendar()
// anywhere below it.

import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase.js';
import { signInForCalendar, signOutOfGoogle } from './calendar.js';

const CalendarContext = createContext(null);

export function CalendarProvider({ children }) {
  const [user, setUser] = useState(null);
  // The Google OAuth access token. Firebase restores the signed-in user across
  // reloads but not this token, so it is null until the first connect of a
  // session; runWithToken re-prompts when that happens.
  const [accessToken, setAccessToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u)), []);

  async function connect() {
    setBusy(true);
    setError('');
    try {
      const result = await signInForCalendar();
      setUser(result.user);
      setAccessToken(result.accessToken);
      return result.accessToken;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await signOutOfGoogle();
    setUser(null);
    setAccessToken(null);
  }

  // Make sure we hold a token, prompting the Google popup if we do not.
  async function ensureToken() {
    return accessToken || connect();
  }

  // Run a calendar call with a valid token. If the token has expired mid-call,
  // re-auth once and try again so the user is not left with a dead button.
  async function runWithToken(fn) {
    const token = await ensureToken();
    try {
      return await fn(token);
    } catch (err) {
      if (err?.code === 'auth-expired') {
        setAccessToken(null);
        const fresh = await connect();
        return fn(fresh);
      }
      throw err;
    }
  }

  const value = { user, accessToken, busy, error, connect, disconnect, ensureToken, runWithToken };
  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendar() {
  const ctx = useContext(CalendarContext);
  if (!ctx) {
    throw new Error('useCalendar must be used inside <CalendarProvider>');
  }
  return ctx;
}
