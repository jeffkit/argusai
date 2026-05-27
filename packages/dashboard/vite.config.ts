import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: '.',
  resolve: { alias: { '@': path.resolve(__dirname, './ui') } },
  server: {
    port: 9091,
    proxy: { '/api': { target: 'http://localhost:9095', changeOrigin: true } },
  },
  build: { outDir: 'dist/public', emptyOutDir: true },
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(process.env.VITE_API_BASE_URL || ''),
    'import.meta.env.VITE_AUTH_REQUIRED': JSON.stringify(process.env.VITE_AUTH_REQUIRED || 'false'),
  },
});
