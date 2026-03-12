import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(), // Tailwind MUST come before Svelte!
    svelte({
      onwarn: (warning, handler) => {
        // Suppress PostCSS warnings - we use Tailwind Vite plugin instead
        if (warning.code === 'css-unused-selector' ||
            warning.message?.includes('postcss') ||
            warning.message?.includes('tailwindcss')) {
          return;
        }
        handler(warning);
      }
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../webview-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  server: {
    port: 5173,
  },
});

