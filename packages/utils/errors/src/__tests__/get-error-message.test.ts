import { describe, expect, it } from "vitest";
import { AppError, BadRequestError, getErrorMessage } from "../index";

describe("getErrorMessage", () => {
  it("returns the message of an Error instance", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns the message of an AppError", () => {
    expect(getErrorMessage(new BadRequestError("bad input"))).toBe("bad input");
  });

  it("reads a message string from plain objects", () => {
    expect(getErrorMessage({ message: "orpc failed" })).toBe("orpc failed");
  });

  it("handles raw strings", () => {
    expect(getErrorMessage("network reset")).toBe("network reset");
  });

  it("never rethrows or returns undefined for opaque values", () => {
    expect(typeof getErrorMessage(undefined)).toBe("string");
    expect(typeof getErrorMessage(null)).toBe("string");
    expect(typeof getErrorMessage(42)).toBe("string");
    expect(typeof getErrorMessage({})).toBe("string");
    expect(getErrorMessage(undefined)).toBe("Unknown error");
  });

  it("prefers Error message over a nested message property", () => {
    const wrapped = new Error("outer");
    (wrapped as unknown as { message2?: string }).message2 = "inner";
    expect(getErrorMessage(wrapped)).toBe("outer");
  });
});
