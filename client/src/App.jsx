import { useState } from 'react';
import Capture from './Capture.jsx';
import Plan from './Plan.jsx';
import Simulate from './Simulate.jsx';

// One screen at a time, calm, never a dashboard. The plan is the home view once
// there are tasks; capture and simulate are one understated tap away.
export default function App() {
  const [view, setView] = useState('plan');
  // Bumping this key remounts the plan so a fresh capture is reflected.
  const [planKey, setPlanKey] = useState(0);

  function goPlan() {
    setPlanKey((k) => k + 1);
    setView('plan');
  }

  const tabs = [
    { id: 'plan', label: 'Plan' },
    { id: 'simulate', label: 'Simulate' },
    { id: 'capture', label: 'Capture' },
  ];

  return (
    <main className="screen">
      <nav className="nav">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`nav-link${view === t.id ? ' active' : ''}`}
            onClick={() => (t.id === 'plan' ? goPlan() : setView(t.id))}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {view === 'capture' && <Capture onCaptured={goPlan} />}
      {view === 'simulate' && <Simulate />}
      {view === 'plan' && <Plan key={planKey} />}
    </main>
  );
}
