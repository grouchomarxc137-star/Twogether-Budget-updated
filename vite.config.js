import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  server: {
    // scripts/dev.js passes PORT; 5180 when run on its own.
    port: Number(process.env.PORT) || 5180,
    strictPort: true
  }
});
