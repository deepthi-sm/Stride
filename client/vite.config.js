import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In local dev the client runs on Vite's port and proxies /api to the Express
// server on 8787, so the frontend never needs to know the backend's address.
// (8080 is avoided because a local Jenkins commonly squats on it.)
// In production the client is built to dist and served by Express directly.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
