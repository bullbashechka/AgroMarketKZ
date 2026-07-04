import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Единый корневой .env (только VITE_-переменные попадают в клиент; секреты бэкенда игнорируются).
  envDir: "..",
  server: {
    port: 5173,
    // Разрешаем доступ через туннели (ngrok/cloudflared) для тестирования Telegram Mini App.
    allowedHosts: [".ngrok-free.dev", ".trycloudflare.com"],
    // Проксируем backend на dev-сервере: с одним туннелем (только webapp) запросы к API
    // остаются same-origin для браузера — не нужен второй публичный туннель и не мешает CORS.
    proxy: {
      "/auth": "http://localhost:3000",
      "/profile": "http://localhost:3000",
      "/catalog": "http://localhost:3000",
      "/settings": "http://localhost:3000",
      "/favorites": "http://localhost:3000",
      "/requests": "http://localhost:3000",
      "/feedback": "http://localhost:3000",
      "/admin": "http://localhost:3000",
      "/health": "http://localhost:3000"
    }
  }
});
