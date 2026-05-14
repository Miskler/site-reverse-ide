import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  publicDir: 'static',
  optimizeDeps: {
    exclude: [
      '@uiw/react-codemirror',
      '@uiw/codemirror-extensions-basic-setup',
      '@codemirror/commands',
      '@codemirror/lang-json',
      '@codemirror/language',
      '@codemirror/state',
      '@codemirror/theme-one-dark',
      '@codemirror/view',
      '@lezer/common',
      '@lezer/highlight',
      '@lezer/lr',
      'codemirror',
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
