import { describe, expect, it } from "vitest";

import {
  asIsoString,
  normalizeEnvironment,
  normalizeHealth,
  normalizeImageDigest,
  normalizeImageLabels,
  normalizeImageSizeBytes,
  normalizeNonNegativeInt,
  normalizePercent,
  normalizeStatus,
  normalizeStringArray,
} from "./mesh-entity-normalization";

describe("mesh entity normalization", () => {
  it("reads a status or health case-insensitively and falls back to unknown or none", () => {
    expect(normalizeStatus("RUNNING")).toBe("running");
    expect(normalizeStatus("weird")).toBe("unknown");
    expect(normalizeStatus(5)).toBe("unknown");
    expect(normalizeHealth("unhealthy")).toBe("unhealthy");
    expect(normalizeHealth("???")).toBe("none");
  });

  it("only accepts a known deployment environment", () => {
    expect(normalizeEnvironment("production")).toBe("production");
    expect(normalizeEnvironment("qa")).toBeNull();
  });

  it("coerces loose numbers: percentages are bounded, counts must be non-negative integers (anything else is 0)", () => {
    expect(normalizePercent(42.5)).toBe(42.5);
    expect(normalizePercent("x")).toBeNull();
    expect(normalizeNonNegativeInt(-3)).toBe(0);
    expect(normalizeNonNegativeInt(2.9)).toBe(0);
    expect(normalizeNonNegativeInt(4)).toBe(4);
    expect(normalizeImageSizeBytes("12")).toBeNull();
    expect(normalizeImageSizeBytes(12)).toBe(12);
  });

  it("keeps only usable strings, labels and digests", () => {
    expect(normalizeStringArray(["a", 1, "b"])).toEqual(["a", "b"]);
    expect(normalizeImageLabels({ a: "b", c: 1 })).toEqual({ a: "b" });
    expect(normalizeImageDigest("sha256:abc")).toBe("sha256:abc");
    expect(normalizeImageDigest("")).toBeNull();
  });

  it("turns anything into an ISO timestamp, defaulting to now when unreadable", () => {
    expect(asIsoString("2026-10-01T00:00:00.000Z")).toBe("2026-10-01T00:00:00.000Z");
    expect(Number.isNaN(Date.parse(asIsoString("nope")))).toBe(false);
  });
});
