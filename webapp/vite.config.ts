import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Единый корневой .env (только VITE_-переменные попадают в клиент; секреты бэкенда игнорируются).
  envDir: "..",
  server: {
    port: 5173
  }
});
