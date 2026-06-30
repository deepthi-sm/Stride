import { useEffect, useRef, useState } from 'react';
import { runJob } from './api.js';

const CATEGORY_LABEL = {
  assignment: 'Assignment',
  application: 'Application',
  bill: 'Bill',
  meeting: 'Meeting',
  other: 'Task',
};

function formatDeadline(deadline) {
  if (!deadline) return 'No deadline';
  const d = new Date(deadline + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return deadline;
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatEffort(mins) {
  if (!mins && mins !== 0) return null;
  if (mins < 60) return `${mins} min`;
  const h = Math.round((mins / 60) * 10) / 10;
  return `${h} hr`;
}

// Module 1 capture screen. Type a brain dump, speak it, or photograph it; it all
// becomes text that Gemini parses into tasks. Voice uses the browser's speech
// recognition and image uses on-device OCR, so both stay on the client and the
// existing text capture endpoint is untouched.
export default function Capture({ onCaptured }) {
  const [text, setText] = useState('');
  const [tasks, setTasks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const recRef = useRef(null);

  // Append new text to whatever is already in the box, on its own line.
  function appendText(addition) {
    const clean = (addition || '').trim();
    if (!clean) return;
    setText((prev) => (prev ? `${prev}\n${clean}` : clean));
  }

  // Voice: the Web Speech API transcribes speech to text in the browser.
  function toggleVoice() {
    if (listening) {
      try {
        recRef.current?.stop();
      } catch {
        // ignore
      }
      setListening(false);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Voice input is not supported in this browser. Chrome works best.');
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join(' ');
      appendText(transcript);
    };
    rec.onerror = () => {
      setError('Could not catch that. Try again.');
      setListening(false);
    };
    rec.onend = () => setListening(false);
    setError('');
    setListening(true);
    recRef.current = rec;
    rec.start();
  }

  // Image: read text off a photo with on-device OCR, then drop it in the box.
  async function onImage(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be picked again later
    if (!file) return;
    setOcrBusy(true);
    setError('');
    try {
      const Tesseract = (await import('tesseract.js')).default;
      const { data } = await Tesseract.recognize(file, 'eng');
      const found = (data?.text || '').trim();
      if (found) appendText(found);
      else setError('No readable text found in that image.');
    } catch {
      setError('Could not read that image.');
    } finally {
      setOcrBusy(false);
    }
  }

  // Load anything already captured.
  useEffect(() => {
    fetch('/api/tasks')
      .then((r) => r.json())
      .then((data) => setTasks(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  async function capture(e) {
    e.preventDefault();
    const value = text.trim();
    if (!value || busy) return;

    setBusy(true);
    setError('');
    try {
      // Runs as a backend job: the Gemini parse finishes on the server even if
      // the tab goes inactive while it works.
      const data = await runJob('/api/capture', { text: value });
      const created = Array.isArray(data) ? data : [];
      // Newest on top.
      setTasks((prev) => [...created, ...prev]);
      setText('');
      if (onCaptured) onCaptured();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h1 className="wordmark">Stride</h1>
      <p className="prompt">What is on your plate?</p>

      <form className="capture" onSubmit={capture}>
        <textarea
          className="capture-box"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Dump it all here. Assignment due Friday, internship app tomorrow, pay rent Monday."
          rows={4}
        />

        <div className="capture-tools">
          <button
            type="button"
            className={`capture-tool${listening ? ' on' : ''}`}
            onClick={toggleVoice}
            disabled={busy || ocrBusy}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0014 0M12 18v3" />
            </svg>
            {listening ? 'Listening… tap to stop' : 'Voice'}
          </button>

          <label className={`capture-tool${ocrBusy ? ' busy' : ''}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="5" width="18" height="14" rx="3" />
              <circle cx="9" cy="11" r="2" />
              <path d="M21 16l-5-4-7 6" />
            </svg>
            {ocrBusy ? 'Reading image…' : 'Image'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onImage}
              disabled={busy || ocrBusy}
              hidden
            />
          </label>
        </div>

        <button className="capture-btn" type="submit" disabled={busy || !text.trim()}>
          {busy ? 'Reading…' : 'Capture'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {tasks.length > 0 && (
        <ul className="task-list">
          {tasks.map((t) => {
            const effort = formatEffort(t.estEffortMins);
            return (
              <li key={t.id} className="task">
                <div className="task-title">{t.title}</div>
                <div className="task-meta">
                  <span className="task-tag">{CATEGORY_LABEL[t.category] || 'Task'}</span>
                  <span>{formatDeadline(t.deadline)}</span>
                  {effort && <span>{effort}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
