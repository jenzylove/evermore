import { defineConfig } from 'vite';
import { resolve } from 'node:path';
// dedupe: the sdk (../sdk) and WizardConnect must share one libauth
// two pages: the landing page (index.html, no 3D) and the game (play.html)
export default defineConfig({ server: { port: 5190, host: true },
  build: { target: 'es2022', rollupOptions: { input: { main: resolve(__dirname, 'index.html'), play: resolve(__dirname, 'play.html'), proof: resolve(__dirname, 'proof.html'), deck: resolve(__dirname, 'deck.html') } } },
  resolve: { dedupe: ['@bitauth/libauth'] },
  // libauth uses top level await
  optimizeDeps: { esbuildOptions: { target: 'es2022' } } });
