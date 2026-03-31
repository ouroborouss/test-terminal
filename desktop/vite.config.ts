import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    target: 'chrome120',
    rollupOptions: {
      input: {
        main: 'index.html',
        overlay: 'overlay.html',
        cli: 'cli.html',
      },
    },
  },
});
