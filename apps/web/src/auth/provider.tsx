import type { ReactNode } from "react";
import { AuthProvider } from "@descope/react-sdk";
import { descopeBaseUrl, descopeProjectId } from "./config.js";

export function DescopeRoot({ children }: { children: ReactNode }) {
  const projectId = descopeProjectId();
  if (!projectId) return children;
  const baseUrl = descopeBaseUrl();
  return (
    <AuthProvider projectId={projectId} {...(baseUrl ? { baseUrl } : {})}>
      {children}
    </AuthProvider>
  );
}
