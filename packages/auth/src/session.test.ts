import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authenticateDescopeSession,
  handleMeRequest,
  readBearerToken,
  sessionUserFromToken,
} from "./session.js";

const PROJECT_ID = "P2exampleprojectid000000000000";

describe("readBearerToken", () => {
  it("reads a bearer token", () => {
    assert.equal(readBearerToken("Bearer session-jwt"), "session-jwt");
    assert.equal(readBearerToken("bearer session-jwt"), "session-jwt");
  });

  it("rejects missing and non-bearer headers", () => {
    assert.equal(readBearerToken(undefined), null);
    assert.equal(readBearerToken(null), null);
    assert.equal(readBearerToken(""), null);
    assert.equal(readBearerToken("Basic abc"), null);
    assert.equal(readBearerToken("Bearer"), null);
    assert.equal(readBearerToken("Bearer a b"), null);
  });
});

describe("sessionUserFromToken", () => {
  it("maps subject, email, name, and expiry", () => {
    assert.deepEqual(
      sessionUserFromToken({
        sub: "user-1",
        email: "ada@example.com",
        name: "Ada",
        exp: 1_700_000_000,
      }),
      {
        userId: "user-1",
        email: "ada@example.com",
        name: "Ada",
        expiresAt: 1_700_000_000,
      },
    );
  });

  it("returns null without a subject", () => {
    assert.equal(sessionUserFromToken({ email: "ada@example.com" }), null);
    assert.equal(sessionUserFromToken({ sub: "  " }), null);
  });
});

describe("handleMeRequest", () => {
  it("returns 503 when the project id is missing", async () => {
    const result = await handleMeRequest(
      { method: "GET", authorization: "Bearer token" },
      { env: {} },
    );
    assert.equal(result.status, 503);
    assert.equal("error" in result.body, true);
  });

  it("returns 401 when the session token is missing", async () => {
    let called = false;
    const result = await handleMeRequest(
      { method: "GET", authorization: undefined },
      {
        env: { DESCOPE_PROJECT_ID: PROJECT_ID },
        validateSession: async () => {
          called = true;
          return { token: { sub: "user-1" } };
        },
      },
    );
    assert.equal(result.status, 401);
    assert.equal(called, false);
  });

  it("returns 405 for non-GET requests without validating", async () => {
    let called = false;
    const result = await handleMeRequest(
      { method: "POST", authorization: "Bearer token" },
      {
        env: { DESCOPE_PROJECT_ID: PROJECT_ID },
        validateSession: async () => {
          called = true;
          return { token: { sub: "user-1" } };
        },
      },
    );
    assert.equal(result.status, 405);
    assert.equal(called, false);
  });

  it("validates the bearer token against the project id audience", async () => {
    let seen: { token: string; audience?: string | string[] } | undefined;
    const result = await handleMeRequest(
      { method: "GET", authorization: "Bearer session-jwt" },
      {
        env: { VITE_DESCOPE_PROJECT_ID: PROJECT_ID },
        validateSession: async (token, options) => {
          seen = { token, audience: options?.audience };
          return {
            token: {
              sub: "user-1",
              email: "ada@example.com",
              name: "Ada Lovelace",
              exp: 123,
            },
          };
        },
      },
    );
    assert.deepEqual(seen, { token: "session-jwt", audience: PROJECT_ID });
    assert.deepEqual(result, {
      status: 200,
      body: {
        authenticated: true,
        user: {
          userId: "user-1",
          email: "ada@example.com",
          name: "Ada Lovelace",
          expiresAt: 123,
        },
      },
    });
  });

  it("returns 401 when validation fails or the subject is missing", async () => {
    const invalid = await authenticateDescopeSession("Bearer nope", {
      env: { DESCOPE_PROJECT_ID: PROJECT_ID },
      validateSession: async () => {
        throw new Error("bad signature");
      },
    });
    assert.equal(invalid.ok, false);

    const missingSub = await handleMeRequest(
      { method: "GET", authorization: "Bearer session-jwt" },
      {
        env: { DESCOPE_PROJECT_ID: PROJECT_ID },
        validateSession: async () => ({ token: { email: "ada@example.com" } }),
      },
    );
    assert.equal(missingSub.status, 401);
  });

  it("prefers DESCOPE_PROJECT_ID over the Vite public value", async () => {
    let audience: string | string[] | undefined;
    await handleMeRequest(
      { method: "GET", authorization: "Bearer session-jwt" },
      {
        env: {
          DESCOPE_PROJECT_ID: "P-server",
          VITE_DESCOPE_PROJECT_ID: "P-client",
        },
        validateSession: async (_token, options) => {
          audience = options?.audience;
          return { token: { sub: "user-1" } };
        },
      },
    );
    assert.equal(audience, "P-server");
  });
});
