import { useState } from 'react';

const BAND_LABEL = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
  critical: 'Critical',
};

// Turn one structured change into a plain readable line.
export function formatChange(c) {
  switch (c.type) {
    case 'delay_days':
      return `Delay ${c.targetTitle} by ${c.value} ${c.value === 1 ? 'day' : 'days'}`;
    case 'set_effort_mins':
      return `Set ${c.targetTitle} to ${c.value} min of effort`;
    case 'move_last':
      return `Move ${c.targetTitle} to last`;
    case 'remove':
      return `Drop ${c.targetTitle}`;
    default:
      return `${c.type} ${c.targetTitle}`;
  }
}

export function ChangeList({ changes }) {
  if (!changes?.length) {
    return <p className="change-empty">No real change matched that question.</p>;
  }
  return (
    <ul className="change-list">
      {changes.map((c, i) => (
        <li key={i} className="change">{formatChange(c)}</li>
      ))}
    </ul>
  );
}

// The shared cascade and one recommendation, used by both simulate and rescue.
export function CascadeResult({ cascade, recommendation, newRiskBand }) {
  return (
    <>
      {newRiskBand && (
        <p className="result-band">
          Risk after this: <span className={`band band-${newRiskBand}`}>{BAND_LABEL[newRiskBand] || newRiskBand}</span>
        </p>
      )}
      {cascade?.length > 0 && (
        <ul className="cascade-list">
          {cascade.map((line, i) => (
            <li key={i} className="cascade">{line}</li>
          ))}
        </ul>
      )}
      {recommendation && (
        <p className="recommendation">
          <span className="recommendation-label">Recommendation</span> {recommendation}
        </p>
      )}
    </>
  );
}

export function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button type="button" className="copy-btn" onClick={copy}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// The rescue view: what to protect, what can wait, and a drafted message to buy
// time. Calm, never alarming.
export default function RescuePanel({ result, onDismiss }) {
  if (!result?.rescue) return null;
  const { rescue, cascade, recommendation, newRiskBand } = result;

  return (
    <section className="rescue-panel">
      <div className="rescue-head">
        <span className="rescue-kicker">Rescue plan</span>
        {onDismiss && (
          <button type="button" className="rescue-close" onClick={onDismiss} aria-label="Dismiss">
            ×
          </button>
        )}
      </div>

      <div className="rescue-rows">
        {rescue.protect && (
          <div className="rescue-row">
            <span className="rescue-label protect">Protect</span>
            <span className="rescue-task">{rescue.protect.title}</span>
          </div>
        )}
        {rescue.drop && (
          <div className="rescue-row">
            <span className="rescue-label drop">Let wait</span>
            <span className="rescue-task">{rescue.drop.title}</span>
          </div>
        )}
      </div>

      {rescue.message && (
        <div className="rescue-message">
          <div className="rescue-message-head">
            <span className="rescue-message-label">A message to buy time</span>
            <CopyButton text={rescue.message} />
          </div>
          <pre className="rescue-message-body">{rescue.message}</pre>
        </div>
      )}

      <CascadeResult cascade={cascade} recommendation={recommendation} newRiskBand={newRiskBand} />
    </section>
  );
}
