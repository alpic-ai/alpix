import DescopeClient from "@descope/node-sdk";
import { readDescopeBaseUrl, readDescopeProjectId, type Env } from "./config.js";

export type SessionToken = Record<string, unknown>;

export type SessionValidation = {
  token?: SessionToken | null;
};

export type ValidateSession = (
  sessionToken: string,
  options: { audience: string },
) => Promise<SessionValidation>;

type DescopeClientLike = {
  validateSession: (
    sessionToken: string,
    options?: { audience?: string | string[] },
  ) => Promise<SessionValidation>;
};

const clients = new Map<string, DescopeClientLike>();

export function createDescopeClient(env: Env = process.env): DescopeClientLike {
  const projectId = readDescopeProjectId(env);
  const baseUrl = readDescopeBaseUrl(env);
  const cacheKey = `${projectId}\n${baseUrl ?? ""}`;
  const cached = clients.get(cacheKey);
  if (cached) return cached;

  const client = DescopeClient({
    projectId,
    ...(baseUrl ? { baseUrl } : {}),
  }) as DescopeClientLike;
  clients.set(cacheKey, client);
  return client;
}

export function validateWithClient(env: Env): ValidateSession {
  const client = createDescopeClient(env);
  return (sessionToken, options) =>
    client.validateSession(sessionToken, { audience: options.audience });
}
