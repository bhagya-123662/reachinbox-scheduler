import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = 'http://localhost:4000';

// Proxying keeps the session cookie same-origin and lets OAuth redirect URIs live on the frontend origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: true, // allow ngrok-style tunnels (needed for Slack OAuth over https)
    proxy: {
      '/api': backend,
      '/auth': backend,
      '/admin': backend,
    },
  },
});
