import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-path.js";

describe("safeNextPath", () => {
  it("keeps in-app paths", () => {
    expect(safeNextPath("/account")).toBe("/account");
    expect(safeNextPath("/account?from=canvas")).toBe("/account?from=canvas");
  });

  it("falls back to the canvas for missing or external targets", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("")).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("/account\n")).toBe("/");
  });
});
