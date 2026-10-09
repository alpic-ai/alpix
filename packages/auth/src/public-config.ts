/** Hosted flow used when VITE_DESCOPE_FLOW_ID is unset or invalid. */
export const DEFAULT_DESCOPE_FLOW_ID = "sign-up-or-in";

export const MISSING_DESCOPE_PROJECT_ID =
  "Missing DESCOPE_PROJECT_ID. Create a project at https://app.descope.com and set DESCOPE_PROJECT_ID to that project's ID (Project Settings). The web build also accepts VITE_DESCOPE_PROJECT_ID as an alias. A Descope management key is not required for sign-in or session validation.";

const FLOW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;

export type PublicDescopeConfig = {
  projectId: string;
  baseUrl: string;
  flowId: string;
};

/**
 * Browser-safe Descope settings. The project ID is public; this helper never
 * reads a management key.
 */
export function publicDescopeConfig(
  env: Record<string, string | undefined>,
): PublicDescopeConfig {
  const projectId = (
    env.VITE_DESCOPE_PROJECT_ID ||
    env.DESCOPE_PROJECT_ID ||
    ""
  ).trim();
  const baseUrl = (env.VITE_DESCOPE_BASE_URL || env.DESCOPE_BASE_URL || "").trim();
  const requested = (env.VITE_DESCOPE_FLOW_ID || DEFAULT_DESCOPE_FLOW_ID).trim();
  const flowId = FLOW_ID_PATTERN.test(requested)
    ? requested
    : DEFAULT_DESCOPE_FLOW_ID;
  return { projectId, baseUrl, flowId };
}
