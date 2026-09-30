import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, watch: { ignored: ['**/test-results/**', '**/integration-results/**'] }, proxy: { '/api': process.env.STUDIO_API_TARGET || 'http://127.0.0.1:8000' } },
});
