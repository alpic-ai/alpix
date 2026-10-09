import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { createDescopeSessionMiddleware } from "./server/session-api.js";

function descopeSessionApi(): Plugin {
  return {
    name: "descope-session-api",
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.envDir, "");
      server.middlewares.use(createDescopeSessionMiddleware(env));
    },
    configurePreviewServer(server) {
      const env = loadEnv(server.config.mode, server.config.envDir, "");
      server.middlewares.use(createDescopeSessionMiddleware(env));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), descopeSessionApi()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    fs: {
      allow: ["../.."],
    },
  },
});
