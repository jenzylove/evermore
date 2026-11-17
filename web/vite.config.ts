import { defineConfig } from 'vite';
// dedupe: the sdk (../sdk) and WizardConnect must share one libauth
export default defineConfig({ server: { port: 5190, host: true }, build: { target: 'es2022' }, resolve: { dedupe: ['@bitauth/libauth'] },
  // libauth uses top level await
  optimizeDeps: { esbuildOptions: { target: 'es2022' } } });
