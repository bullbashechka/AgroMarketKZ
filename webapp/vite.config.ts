import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true,
  },
  // Единый корневой .env (только VITE_-переменные попадают в клиент; секреты бэкенда игнорируются).
  envDir: "..",
  server: {
    port: 5173,
    // Разрешаем доступ через туннели (ngrok/cloudflared) для тестирования Telegram Mini App.
    allowedHosts: [".ngrok-free.dev", ".trycloudflare.com"],
    // Local equivalent of the Pages /api proxy used in production.
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      }
    }
  }
});
