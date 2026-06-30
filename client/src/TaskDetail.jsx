import { useEffect, useState } from 'react';
import { CopyButton } from './RescuePanel.jsx';

const TYPE_LABEL = {
  draft_email: 'Draft email',
  checklist: 'Checklist',
  prep_doc: 'Prep doc',
};

// The task detail view: Stride does the first piece of the work. The deliverable
// is editable so you can tweak it before you copy it out.
export default function TaskDetail({ task, onBack }) {
  const [type, setType] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/tasks/${task.id}/action`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not draft that.');
      setType(data.deliverableType);
      setText(data.deliverable);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  return (
    <div className="panel">
      <button type="button" className="back-btn" onClick={onBack}>
        ← Back to plan
      </button>
      <h2 className="detail-title">{task.title}</h2>

      {busy && <p className="prompt">Drafting the first move…</p>}
      {error && <p className="error">{error}</p>}

      {!busy && !error && (
        <section className="detail">
          <div className="detail-head">
            <span className="detail-type">{TYPE_LABEL[type] || 'Draft'}</span>
            <div className="detail-actions">
              <CopyButton text={text} />
              <button type="button" className="link-btn" onClick={generate}>
                Regenerate
              </button>
            </div>
          </div>
          <textarea
            className="detail-box"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={16}
          />
          <p className="detail-hint">Edit anything you like, then copy it out.</p>
        </section>
      )}
    </div>
  );
}
