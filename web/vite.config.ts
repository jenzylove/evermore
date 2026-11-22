import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// every build gets an id; the game compares it with /version.json so a phone that kept an old copy in memory
// reloads itself to the new one (never in the middle of a fight)
const BUILD = String(Date.now());

// dedupe: the sdk (../sdk) and WizardConnect must share one libauth
// two pages: the landing page (index.html, no 3D) and the game (play.html)
export default defineConfig({ server: { port: 5190, host: true },
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [{ name: 'version-file', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) }); } }],
  build: { target: 'es2022', rollupOptions: { input: { main: resolve(__dirname, 'index.html'), play: resolve(__dirname, 'play.html'), proof: resolve(__dirname, 'proof.html'), deck: resolve(__dirname, 'deck.html') } } },
  resolve: { dedupe: ['@bitauth/libauth'] },
  // libauth uses top level await
  optimizeDeps: { esbuildOptions: { target: 'es2022' } } });
