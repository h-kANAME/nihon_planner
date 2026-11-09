import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Permite import() dinámico del parser compartido desde src/
      shared: path.resolve(rootDir, "shared"),
    },
  },
  server: {
    host: true,
    port: 5173,
    fs: {
      // shared/ está en la raíz del monorepo (fuera de src/)
      allow: [rootDir],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        // NDJSON de import-md: no bufferizar el stream de progreso
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (req.url?.includes("/itinerary/import-md")) {
              proxyReq.setHeader("Connection", "keep-alive");
            }
          });
        },
      },
      "/health": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
