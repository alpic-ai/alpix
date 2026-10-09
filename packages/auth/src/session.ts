import DescopeClient from "@descope/node-sdk";

/** Descope's built-in flow that both signs up and signs in. */
export const DEFAULT_DESCOPE_FLOW_ID = "sign-up-or-in";

export type DescopeSessionUser = {
  userId: string;
  email?: string;
  name?: string;
  /** JWT `exp`, in seconds since the epoch. */
  expiresAt?: number;
};

export type SessionErrorBody = { error: string };

export type SessionSuccessBody = {
  authenticated: true;
  user: DescopeSessionUser;
};

export type SessionResponseBody = SessionSuccessBody | SessionErrorBody;

export type SessionHttpResult = {
  status: number;
  body: SessionResponseBody;
};

type Env = Record<string, string | undefined>;

export type ValidatedToken = Record<string, unknown>;

export type ValidateSession = (
  sessionToken: string,
  options?: { audience?: string | string[] },
) => Promise<{ token: ValidatedToken }>;

export type AuthenticateOptions = {
  env?: Env;
  validateSession?: ValidateSession;
};

type DescopeSdk = ReturnType<typeof DescopeClient>;

let clientCache: { key: string; client: DescopeSdk } | undefined;

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

/** Project ID used to validate session JWTs. The management key is never read. */
export function descopeProjectId(env: Env = process.env): string | undefined {
  return trimmed(env.DESCOPE_PROJECT_ID) ?? trimmed(env.VITE_DESCOPE_PROJECT_ID);
}

export function descopeBaseUrl(env: Env = process.env): string | undefined {
  return trimmed(env.DESCOPE_BASE_URL) ?? trimmed(env.VITE_DESCOPE_BASE_URL);
}

export function readBearerToken(
  authorization: string | null | undefined,
): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

export function sessionUserFromToken(
  token: ValidatedToken,
): DescopeSessionUser | null {
  const sub = typeof token.sub === "string" ? token.sub.trim() : "";
  if (!sub) return null;
  const email = typeof token.email === "string" ? token.email.trim() : "";
  const name = typeof token.name === "string" ? token.name.trim() : "";
  const user: DescopeSessionUser = { userId: sub };
  if (email) user.email = email;
  if (name) user.name = name;
  if (typeof token.exp === "number" && Number.isFinite(token.exp)) {
    user.expiresAt = token.exp;
  }
  return user;
}

function getDescopeClient(projectId: string, baseUrl: string | undefined): DescopeSdk {
  const key = `${projectId}\n${baseUrl ?? ""}`;
  if (clientCache?.key === key) return clientCache.client;
  const client = DescopeClient({
    projectId,
    ...(baseUrl ? { baseUrl } : {}),
  });
  clientCache = { key, client };
  return client;
}

export async function authenticateDescopeSession(
  authorization: string | null | undefined,
  options: AuthenticateOptions = {},
): Promise<
  | { ok: true; user: DescopeSessionUser }
  | { ok: false; status: 401 | 503; error: string }
> {
  const env = options.env ?? process.env;
  const projectId = descopeProjectId(env);
  if (!projectId) {
    return {
      ok: false,
      status: 503,
      error:
        "Descope is not configured. Set DESCOPE_PROJECT_ID to your Descope project ID.",
    };
  }

  const sessionToken = readBearerToken(authorization);
  if (!sessionToken) {
    return {
      ok: false,
      status: 401,
      error: "Missing Descope session token. Sign in and retry.",
    };
  }

  const validate =
    options.validateSession ??
    (async (token, verify) => {
      const client = getDescopeClient(projectId, descopeBaseUrl(env));
      const authInfo = await client.validateSession(token, verify);
      return { token: authInfo.token as ValidatedToken };
    });

  try {
    const authInfo = await validate(sessionToken, { audience: projectId });
    const user = sessionUserFromToken(authInfo.token);
    if (!user) {
      return {
        ok: false,
        status: 401,
        error: "Descope session token is missing a subject.",
      };
    }
    return { ok: true, user };
  } catch {
    return {
      ok: false,
      status: 401,
      error: "Invalid or expired Descope session token.",
    };
  }
}

export async function handleMeRequest(
  input: { method?: string; authorization: string | null | undefined },
  options: AuthenticateOptions = {},
): Promise<SessionHttpResult> {
  if (input.method && input.method.toUpperCase() !== "GET") {
    return { status: 405, body: { error: "Method not allowed." } };
  }

  const result = await authenticateDescopeSession(input.authorization, options);
  if (!result.ok) {
    return { status: result.status, body: { error: result.error } };
  }
  return { status: 200, body: { authenticated: true, user: result.user } };
}
