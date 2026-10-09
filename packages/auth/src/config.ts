import { MISSING_DESCOPE_PROJECT_ID } from "./public-config.js";

export { MISSING_DESCOPE_PROJECT_ID };

export class DescopeConfigError extends Error {
  constructor(message: string = MISSING_DESCOPE_PROJECT_ID) {
    super(message);
    this.name = "DescopeConfigError";
  }
}

export type Env = Record<string, string | undefined>;

export function readDescopeProjectId(env: Env = process.env): string {
  const id = (env.DESCOPE_PROJECT_ID || env.VITE_DESCOPE_PROJECT_ID || "").trim();
  if (!id) throw new DescopeConfigError();
  return id;
}

export function readDescopeBaseUrl(env: Env = process.env): string | undefined {
  const baseUrl = (env.DESCOPE_BASE_URL || env.VITE_DESCOPE_BASE_URL || "").trim();
  return baseUrl || undefined;
}

/** Session JWT `aud`. Defaults to the project ID, which is Descope's default audience. */
export function readSessionAudience(env: Env = process.env): string {
  const custom = env.DESCOPE_SESSION_AUDIENCE?.trim();
  if (custom) return custom;
  return readDescopeProjectId(env);
}
