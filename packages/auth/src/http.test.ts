import { describe, expect, it, vi } from "vitest";
import { type ValidateSession } from "./client.js";
import { MISSING_DESCOPE_PROJECT_ID } from "./config.js";
import { handleSessionRequest } from "./http.js";
import { publicDescopeConfig } from "./public-config.js";

const env = { DESCOPE_PROJECT_ID: "P_test_project" };

function request(method: string, authorization?: string): Request {
  return new Request("http://127.0.0.1/api/session", {
    method,
    headers: authorization ? { authorization } : {},
  });
}

describe("handleSessionRequest", () => {
  it("returns 503 when the project id is missing", async () => {
    const validateSession = vi.fn<ValidateSession>();
    const response = await handleSessionRequest(request("GET", "Bearer token"), {
      env: {},
      validateSession,
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: MISSING_DESCOPE_PROJECT_ID,
    });
    expect(validateSession).not.toHaveBeenCalled();
  });

  it("returns 401 when the bearer token is missing", async () => {
    const validateSession = vi.fn<ValidateSession>();
    const response = await handleSessionRequest(request("GET"), {
      env,
      validateSession,
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/Sign in required/);
    expect(validateSession).not.toHaveBeenCalled();
  });

  it("returns 401 when Descope rejects the session", async () => {
    const validateSession: ValidateSession = async () => {
      throw new Error("expired");
    };
    const response = await handleSessionRequest(request("GET", "Bearer expired"), {
      env,
      validateSession,
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Descope session is invalid or expired.",
    });
  });

  it("returns the user id when the session is valid and checks audience", async () => {
    const validateSession: ValidateSession = async (token, options) => {
      expect(token).toBe("good-token");
      expect(options.audience).toBe("P_test_project");
      return {
        token: {
          sub: "U2user",
          email: "ada@example.com",
          name: "Ada",
          loginIds: ["ada@example.com"],
        },
      };
    };
    const response = await handleSessionRequest(request("GET", "Bearer good-token"), {
      env,
      validateSession,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      user: {
        userId: "U2user",
        email: "ada@example.com",
        name: "Ada",
        loginIds: ["ada@example.com"],
      },
    });
  });

  it("returns 401 when the token has no subject", async () => {
    const validateSession: ValidateSession = async () => ({ token: {} });
    const response = await handleSessionRequest(request("GET", "Bearer nosub"), {
      env,
      validateSession,
    });
    expect(response.status).toBe(401);
  });

  it("returns 405 for other methods", async () => {
    const response = await handleSessionRequest(request("POST", "Bearer token"), {
      env,
    });
    expect(response.status).toBe(405);
  });

  it("uses DESCOPE_SESSION_AUDIENCE when set", async () => {
    let seen = "";
    const validateSession: ValidateSession = async (_token, options) => {
      seen = options.audience;
      return { token: { sub: "U2user" } };
    };
    const response = await handleSessionRequest(request("GET", "Bearer good-token"), {
      env: { ...env, DESCOPE_SESSION_AUDIENCE: "alpix-api" },
      validateSession,
    });
    expect(response.status).toBe(200);
    expect(seen).toBe("alpix-api");
  });
});

describe("publicDescopeConfig", () => {
  it("prefers the Vite project id and defaults the flow", () => {
    expect(
      publicDescopeConfig({
        VITE_DESCOPE_PROJECT_ID: " Pvite ",
        DESCOPE_PROJECT_ID: "Pserver",
      }),
    ).toEqual({
      projectId: "Pvite",
      baseUrl: "",
      flowId: "sign-up-or-in",
    });
  });

  it("falls back to DESCOPE_PROJECT_ID and rejects unsafe flow ids", () => {
    expect(
      publicDescopeConfig({
        DESCOPE_PROJECT_ID: "Pserver",
        DESCOPE_BASE_URL: "https://auth.example.com",
        VITE_DESCOPE_FLOW_ID: "../nope",
      }),
    ).toEqual({
      projectId: "Pserver",
      baseUrl: "https://auth.example.com",
      flowId: "sign-up-or-in",
    });
  });
});
