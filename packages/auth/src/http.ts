import {
  DescopeConfigError,
  readDescopeProjectId,
  readSessionAudience,
  type Env,
} from "./config.js";
import { bearerToken } from "./bearer.js";
import { validateWithClient, type ValidateSession } from "./client.js";
import { sessionUserFromToken, type SessionUser } from "./user.js";

export class SessionUnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionUnauthorizedError";
  }
}

export type SessionHandlerOptions = {
  env?: Env;
  validateSession?: ValidateSession;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function authorizeSession(
  authorization: string | null | undefined,
  options: SessionHandlerOptions = {},
): Promise<SessionUser> {
  const env = options.env ?? process.env;
  readDescopeProjectId(env);
  const audience = readSessionAudience(env);
  const token = bearerToken(authorization);
  if (!token) {
    throw new SessionUnauthorizedError(
      "Sign in required. Send the Descope session JWT in the Authorization header as a Bearer token.",
    );
  }

  const validate = options.validateSession ?? validateWithClient(env);
  let authInfo: Awaited<ReturnType<ValidateSession>>;
  try {
    authInfo = await validate(token, { audience });
  } catch (error) {
    if (error instanceof DescopeConfigError) throw error;
    throw new SessionUnauthorizedError("Descope session is invalid or expired.");
  }

  const user = sessionUserFromToken(authInfo.token ?? undefined);
  if (!user) {
    throw new SessionUnauthorizedError("Descope session is missing a user id.");
  }
  return user;
}

/**
 * GET /api/session — validates a Descope session JWT.
 * 503 when DESCOPE_PROJECT_ID is missing, 401 when the session is missing or rejected.
 */
export async function handleSessionRequest(
  request: Request,
  options: SessionHandlerOptions = {},
): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed. Use GET." }, 405);
  }

  try {
    const user = await authorizeSession(request.headers.get("authorization"), options);
    return json({ user }, 200);
  } catch (error) {
    if (error instanceof DescopeConfigError) {
      return json({ error: error.message }, 503);
    }
    if (error instanceof SessionUnauthorizedError) {
      return json({ error: error.message }, 401);
    }
    return json({ error: "Could not validate the Descope session." }, 500);
  }
}
