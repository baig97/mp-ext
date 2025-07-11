import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        background: 'src/background.ts',
        // Add popup.html if needed later
      },
      output: {
        entryFileNames: '[name].js',
      },
    },
    emptyOutDir: false,
  }
});