import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        background: 'src/background.ts',
        popup: 'src/popup.tsx',
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Service worker needs to be in ES5/CommonJS format
          if (chunkInfo.name === 'background') {
            return '[name].js';
          }
          return '[name].js';
        },
        format: 'es', // Use ES modules
      },
    },
    emptyOutDir: false,
    target: 'esnext',
  },
  publicDir: 'public',
});