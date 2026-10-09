import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountAccess } from "./access.js";

describe("accountAccess", () => {
  it("blocks the account page until Descope is configured", () => {
    assert.equal(
      accountAccess({
        configured: false,
        sessionLoading: false,
        authenticated: false,
      }),
      "unconfigured",
    );
  });

  it("waits for the session check before redirecting", () => {
    assert.equal(
      accountAccess({
        configured: true,
        sessionLoading: true,
        authenticated: false,
      }),
      "loading",
    );
  });

  it("sends signed-out visitors to the Descope flow", () => {
    assert.equal(
      accountAccess({
        configured: true,
        sessionLoading: false,
        authenticated: false,
      }),
      "login",
    );
  });

  it("allows a validated session", () => {
    assert.equal(
      accountAccess({
        configured: true,
        sessionLoading: false,
        authenticated: true,
      }),
      "allow",
    );
  });
});
