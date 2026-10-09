import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv, type Connect, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { handleSessionRequest } from "../../packages/auth/src/http.ts";
import { publicDescopeConfig } from "../../packages/auth/src/public-config.ts";

function sessionApi(mode: string, envDir: string): Plugin {
  const fileEnv = loadEnv(mode, envDir, "");
  const env = { ...fileEnv, ...process.env };

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url?.split("?")[0];
    if (url !== "/api/session") {
      next();
      return;
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(", "));
    }

    void handleSessionRequest(
      new Request("http://127.0.0.1/api/session", {
        method: req.method,
        headers,
      }),
      { env },
    )
      .then(async (response) => {
        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });
        res.end(Buffer.from(await response.arrayBuffer()));
      })
      .catch(next);
  };

  return {
    name: "alpix-descope-session",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig(({ mode }) => {
  const envDir = import.meta.dirname;
  const fileEnv = loadEnv(mode, envDir, "");
  const descope = publicDescopeConfig({ ...fileEnv, ...process.env });

  return {
    plugins: [react(), tailwindcss(), sessionApi(mode, envDir)],
    define: {
      __ALPIX_DESCOPE_PROJECT_ID__: JSON.stringify(descope.projectId),
      __ALPIX_DESCOPE_BASE_URL__: JSON.stringify(descope.baseUrl),
      __ALPIX_DESCOPE_FLOW_ID__: JSON.stringify(descope.flowId),
    },
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
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  };
});
