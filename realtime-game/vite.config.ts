import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 8080,
    host: '0.0.0.0',
    open: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      }
    }
  },
});

