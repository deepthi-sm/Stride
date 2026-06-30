import { useState } from 'react';

// Module 6 onboarding. Six questions, one per screen, sliding sideways, with
// progress dots and a back arrow. The single-choice questions advance on tap;
// question four is multi-select and waits for a Continue. After the sixth answer
// a reflection screen says back what Stride understood, and its Start button
// saves the profile and lands on the plan.
//
// The questions, options, and stored values match the Profile schema exactly.
// The reflection fragments turn those raw values into plain sentences without
// inventing anything the user did not say.

const QUESTIONS = [
  {
    field: 'role',
    multi: false,
    title: 'Who are you planning for?',
    options: [
      { value: 'student', label: 'A student' },
      { value: 'professional', label: 'A working professional' },
      { value: 'founder', label: 'A founder or freelancer' },
      { value: 'other', label: 'Something else' },
    ],
    summarize: (v) => {
      const map = {
        student: 'You are planning as a student.',
        professional: 'You are planning as a working professional.',
        founder: 'You are planning as a founder or freelancer.',
        other: 'You are planning for your own mix of things.',
      };
      return map[v];
    },
  },
  {
    field: 'productivityWindow',
    multi: false,
    title: 'When are you at your best?',
    options: [
      { value: 'early_morning', label: 'Early morning' },
      { value: 'afternoon', label: 'Afternoon' },
      { value: 'evening', label: 'Evening' },
      { value: 'late_night', label: 'Late night' },
      { value: 'varies', label: 'It varies' },
    ],
    summarize: (v) => {
      const map = {
        early_morning: 'You focus best in the early morning, so that is when work gets placed.',
        afternoon: 'You focus best in the afternoon, so that is when work gets placed.',
        evening: 'You focus best in the evening, so that is when work gets placed.',
        late_night: 'You focus best late at night, so that is when work gets placed.',
        varies: 'Your best hours move around, so the plan stays flexible about timing.',
      };
      return map[v];
    },
  },
  {
    field: 'deadlineStyle',
    multi: false,
    title: 'How do you usually handle deadlines?',
    options: [
      { value: 'early', label: 'I finish early' },
      { value: 'on_time', label: 'Right on time' },
      { value: 'close', label: 'I cut it close' },
      { value: 'last_minute', label: 'All at the last minute' },
    ],
    summarize: (v) => {
      const map = {
        early: 'You tend to finish ahead of time.',
        on_time: 'You tend to land right on time.',
        close: 'You tend to cut it close, so Stride watches the late edges.',
        last_minute: 'You tend to leave things to the last minute, so Stride flags risk early.',
      };
      return map[v];
    },
  },
  {
    field: 'slowdowns',
    multi: true,
    title: 'What usually slows you down?',
    hint: 'Pick as many as fit.',
    options: [
      { value: 'underestimate', label: 'I underestimate how long things take' },
      { value: 'overwhelmed', label: 'I get overwhelmed by big tasks' },
      { value: 'distracted', label: 'I get distracted' },
      { value: 'avoid_starting', label: 'I put off starting' },
      { value: 'forgetful', label: 'I forget things' },
    ],
    summarize: (v) => {
      const frag = {
        underestimate: 'underestimating how long things take',
        overwhelmed: 'feeling overwhelmed by big tasks',
        distracted: 'getting distracted',
        avoid_starting: 'putting off starting',
        forgetful: 'forgetting things',
      };
      const picked = (v || []).map((k) => frag[k]).filter(Boolean);
      if (picked.length === 0) return 'Nothing in particular slows you down.';
      if (picked.length === 1) return `What slows you down most is ${picked[0]}.`;
      const last = picked.pop();
      return `What slows you down: ${picked.join(', ')} and ${last}.`;
    },
  },
  {
    field: 'slips',
    multi: false,
    title: 'What slips through the cracks most?',
    options: [
      { value: 'deadlines', label: 'Deadlines' },
      { value: 'messages', label: 'Messages and replies' },
      { value: 'bills', label: 'Bills and admin' },
      { value: 'goals', label: 'Personal goals' },
      { value: 'none', label: 'Nothing really' },
    ],
    summarize: (v) => {
      const map = {
        deadlines: 'Deadlines are what slip most, so they get the closest watch.',
        messages: 'Messages and replies are what slip most.',
        bills: 'Bills and admin are what slip most.',
        goals: 'Personal goals are what slip most.',
        none: 'Nothing tends to slip much for you.',
      };
      return map[v];
    },
  },
  {
    field: 'rescueStrategy',
    multi: false,
    title: 'How should Stride step in when things go wrong?',
    options: [
      { value: 'rebuild', label: 'Rebuild my plan from now' },
      { value: 'protect', label: 'Protect my most important task' },
      { value: 'suggest_drop', label: 'Tell me what to drop' },
      { value: 'draft_message', label: 'Draft a message to buy time' },
    ],
    summarize: (v) => {
      const map = {
        rebuild: 'When things go wrong, Stride rebuilds the plan from where you are.',
        protect: 'When things go wrong, Stride protects your most important task first.',
        suggest_drop: 'When things go wrong, Stride suggests what to drop to save the rest.',
        draft_message: 'When things go wrong, Stride drafts a message to buy you time.',
      };
      return map[v];
    },
  },
];

// A ready-made profile for anyone who would rather skip ahead and see Stride
// working. Every value is a real schema option, so the plan behaves normally.
const SAMPLE_PROFILE = {
  role: 'student',
  productivityWindow: 'evening',
  deadlineStyle: 'last_minute',
  slowdowns: ['overwhelmed', 'avoid_starting'],
  slips: 'deadlines',
  rescueStrategy: 'rebuild',
};

const TOTAL = QUESTIONS.length; // six question screens, then the reflection

export default function Onboarding({ onComplete }) {
  // step 0..5 are the questions, step 6 is the reflection screen.
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState('next'); // drives the slide direction
  const [answers, setAnswers] = useState({ slowdowns: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function goTo(next, direction) {
    setDir(direction);
    setStep(next);
  }

  function back() {
    if (step === 0 || busy) return;
    goTo(step - 1, 'back');
  }

  // Single-choice answer: record it and slide to the next screen.
  function choose(field, value) {
    if (busy) return;
    setAnswers((a) => ({ ...a, [field]: value }));
    goTo(step + 1, 'next');
  }

  // Multi-select toggle for the slowdowns question.
  function toggle(field, value) {
    setAnswers((a) => {
      const current = Array.isArray(a[field]) ? a[field] : [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...a, [field]: next };
    });
  }

  // Save the profile and hand control back to the app, which shows the plan.
  async function finish(profile) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save your answers.');
      onComplete(data);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const onReflection = step >= TOTAL;
  const q = onReflection ? null : QUESTIONS[step];

  return (
    <div className="panel onboarding">
      <header className="ob-top">
        <button
          type="button"
          className="ob-back"
          onClick={back}
          disabled={step === 0 || busy}
          aria-label="Go back"
          style={{ visibility: step === 0 ? 'hidden' : 'visible' }}
        >
          ←
        </button>
        <div className="ob-dots" aria-hidden="true">
          {QUESTIONS.map((_, i) => (
            <span
              key={i}
              className={`ob-dot${i === step ? ' active' : ''}${
                i < step || onReflection ? ' done' : ''
              }`}
            />
          ))}
        </div>
        <span className="ob-count">
          {onReflection ? 'Done' : `${step + 1} / ${TOTAL}`}
        </span>
      </header>

      <div className="ob-stage">
        <div className={`ob-card slide-${dir}`} key={step}>
          {onReflection ? (
            <Reflection answers={answers} onStart={() => finish(answers)} busy={busy} />
          ) : (
            <Question
              question={q}
              answers={answers}
              onChoose={choose}
              onToggle={toggle}
              onContinue={() => goTo(step + 1, 'next')}
            />
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {!onReflection && (
        <button
          type="button"
          className="ob-skip"
          onClick={() => finish(SAMPLE_PROFILE)}
          disabled={busy}
        >
          Skip and explore with a sample
        </button>
      )}
    </div>
  );
}

function Question({ question, answers, onChoose, onToggle, onContinue }) {
  const { field, multi, title, hint, options } = question;
  const selected = answers[field];

  return (
    <div className="ob-question">
      <h1 className="ob-title">{title}</h1>
      {hint && <p className="ob-hint">{hint}</p>}

      <div className="ob-options">
        {options.map((opt) => {
          const isOn = multi
            ? Array.isArray(selected) && selected.includes(opt.value)
            : selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              className={`ob-option${isOn ? ' on' : ''}`}
              onClick={() =>
                multi ? onToggle(field, opt.value) : onChoose(field, opt.value)
              }
            >
              <span className="ob-option-label">{opt.label}</span>
              {multi && <span className="ob-check" aria-hidden="true">{isOn ? '✓' : ''}</span>}
            </button>
          );
        })}
      </div>

      {multi && (
        <button type="button" className="ob-continue" onClick={onContinue}>
          {Array.isArray(selected) && selected.length > 0 ? 'Continue' : 'None of these'}
        </button>
      )}
    </div>
  );
}

function Reflection({ answers, onStart, busy }) {
  const lines = QUESTIONS.map((q) => q.summarize(answers[q.field]));

  return (
    <div className="ob-reflection">
      <span className="ob-kicker">Here is what I understood</span>
      <h1 className="ob-title">This is how Stride will plan for you</h1>

      <ul className="ob-summary">
        {lines.map((line, i) => (
          <li key={i} className="ob-summary-line">{line}</li>
        ))}
      </ul>

      <button type="button" className="ob-start" onClick={onStart} disabled={busy}>
        {busy ? 'Setting up…' : 'Start'}
      </button>
    </div>
  );
}
