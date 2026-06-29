// Stride server, walking skeleton.
// Loads .env first so process.env is populated before anything reads it.

import 'dotenv/config';

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

// The built client lives at /client/dist, one level up from /server.
const CLIENT_DIST = join(__dirname, '..', 'client', 'dist');
const INDEX_HTML = join(CLIENT_DIST, 'index.html');

const app = express();
app.use(express.json());

// API routes go before the static and catch-all handlers.
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Serve the built client.
app.use(express.static(CLIENT_DIST));

// Catch-all: any non-/api route returns index.html so client-side refresh works.
app.get(/^\/(?!api\/).*/, (req, res) => {
  if (existsSync(INDEX_HTML)) {
    res.sendFile(INDEX_HTML);
  } else {
    res
      .status(200)
      .type('text/plain')
      .send('Client not built yet. Run the client dev server, or build it: cd client && npm run build');
  }
});

app.listen(PORT, () => {
  console.log(`Stride server listening on http://localhost:${PORT}`);
});
