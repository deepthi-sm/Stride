import { useEffect, useState } from 'react';

export default function App() {
  // A quiet check that the frontend can reach the backend in local dev.
  const [health, setHealth] = useState('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setHealth(d.ok ? 'connected' : 'unexpected'))
      .catch(() => setHealth('offline'));
  }, []);

  return (
    <main className="screen">
      <h1 className="wordmark">Stride</h1>
      <p className="status">backend {health}</p>
    </main>
  );
}
