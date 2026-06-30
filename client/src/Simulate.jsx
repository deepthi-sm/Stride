import { useState } from 'react';
import RescuePanel, { ChangeList, CascadeResult } from './RescuePanel.jsx';

// The simulator: ask a free-form what-if and see the cascade, or ask Stride to
// rescue the week when things are slipping.
export default function Simulate() {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function run(q, mode) {
    if (busy) return;
    setBusy(mode);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not run that.');
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  function ask(e) {
    e.preventDefault();
    const q = question.trim();
    if (q) run(q, 'ask');
  }

  return (
    <div className="panel">
      <h1 className="wordmark">Simulate</h1>
      <p className="prompt">Ask a what-if. See the cascade before you commit.</p>

      <form className="sim-form" onSubmit={ask}>
        <textarea
          className="sim-box"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What if I delay the lab report two days? What if the assignment takes twice as long?"
          rows={3}
        />
        <div className="sim-actions">
          <button className="capture-btn" type="submit" disabled={!!busy || !question.trim()}>
            {busy === 'ask' ? 'Thinking…' : 'See what happens'}
          </button>
          <button
            type="button"
            className="link-btn"
            onClick={() => run('', 'rescue')}
            disabled={!!busy}
          >
            {busy === 'rescue' ? 'Rescuing…' : 'Rescue my week'}
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      {result && result.rescue && <RescuePanel result={result} />}

      {result && !result.rescue && (
        <section className="sim-result">
          <h3 className="section-title">The change</h3>
          <ChangeList changes={result.changes} />
          <h3 className="section-title">What follows</h3>
          <CascadeResult
            cascade={result.cascade}
            recommendation={result.recommendation}
            newRiskBand={result.newRiskBand}
          />
        </section>
      )}
    </div>
  );
}
