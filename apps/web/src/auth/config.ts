import { DEFAULT_DESCOPE_FLOW_ID } from "./flow.js";

function trimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const next = value.trim();
  return next ? next : undefined;
}

/** Browser project ID. Empty when sign-in is not configured. */
export function descopeProjectId(): string | undefined {
  return trimmed(import.meta.env.VITE_DESCOPE_PROJECT_ID);
}

export function descopeBaseUrl(): string | undefined {
  return trimmed(import.meta.env.VITE_DESCOPE_BASE_URL);
}

/** Flow rendered for both sign-up and sign-in. */
export function descopeFlowId(): string {
  return trimmed(import.meta.env.VITE_DESCOPE_FLOW_ID) ?? DEFAULT_DESCOPE_FLOW_ID;
}
