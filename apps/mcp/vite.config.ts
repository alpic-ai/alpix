import path from "node:path";
import { createRequire } from "node:module";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { skybridge } from "skybridge/vite";
import { defineConfig } from "vite";

const require = createRequire(import.meta.url);
const skybridgeWeb = require.resolve("skybridge/web");

export default defineConfig({
  plugins: [skybridge(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "skybridge/web": skybridgeWeb,
    },
  },
  server: {
    fs: {
      allow: ["../.."],
    },
  },
});
