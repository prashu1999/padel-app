import { defineConfig } from 'vite';

// A relative base keeps the build portable to GitHub Pages project sites.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: true
  }
});
