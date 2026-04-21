import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy: en dev, las llamadas a /api/* se redirigen al backend sin CORS
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
