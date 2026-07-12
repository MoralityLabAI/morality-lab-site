import { defineConfig } from 'vite';

export default defineConfig({
  base: '/strategy/',
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three-vendor';
          if (id.includes('/src/engine/')) return 'game-engine';
          if (id.includes('/src/three/')) return 'three-scenes';
          if (id.includes('/src/ui/')) return 'ui';
          return undefined;
        }
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
});
