import { defineConfig } from 'vite';

export default defineConfig({
  base: '/editor/',
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
  optimizeDeps: {
    exclude: ['html-encoding-sniffer', '@exodus/bytes'],
  },
  ssr: {
    noExternal: ['html-encoding-sniffer', '@exodus/bytes'],
  },
});
