import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "@descope/react-sdk";
import { DescopeConfigError, StartupError } from "./auth-shell.js";
import { descopeBaseUrl, descopeProjectId } from "./descope-public.js";
import "./index.css";

const root = createRoot(document.getElementById("root")!);

if (!descopeProjectId) {
  root.render(<DescopeConfigError />);
} else {
  void import("./app.js")
    .then(({ App }) => {
      root.render(
        <StrictMode>
          <AuthProvider
            projectId={descopeProjectId}
            {...(descopeBaseUrl ? { baseUrl: descopeBaseUrl } : {})}
          >
            <App />
          </AuthProvider>
        </StrictMode>,
      );
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "The app failed to start.";
      root.render(<StartupError message={message} />);
    });
}
