import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    include: ['server/**/*.test.ts', 'ui/**/*.test.tsx', 'ui/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    environmentMatchGlobs: [
      ['server/**', 'node'],
    ],
  },
});
