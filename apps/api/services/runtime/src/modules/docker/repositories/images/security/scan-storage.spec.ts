import { describe, expect, it } from "vitest";

import { computeScanHash, isMissingScanTableError, toPersistedScan } from "./scan-storage";

const scan = {
  vulnerabilities: [],
  scanSummary: { scannedAt: "x", totalFindings: 0, scanners: [], layerEfficiency: null },
} as never;

describe("scan storage", () => {
  it("hashes on identity, generation and content", () => {
    const base = computeScanHash("img", 1, scan);
    expect(computeScanHash("img", 1, scan)).toBe(base);
    expect(computeScanHash("img", 2, scan)).not.toBe(base);
    expect(computeScanHash("other", 1, scan)).not.toBe(base);
  });

  it("reads a row back, defaulting what the summary lacks", () => {
    const at = new Date("2026-10-01T00:00:00.000Z");
    const read = toPersistedScan({ vulnerabilities: [{}, {}], scanSummary: {}, lastUpdated: at });
    expect(read.scanSummary).toEqual({
      scannedAt: at.toISOString(),
      totalFindings: 2,
      scanners: [],
      layerEfficiency: null,
    });
    expect(toPersistedScan({ vulnerabilities: [], scanSummary: { totalFindings: 7 }, lastUpdated: at }).scanSummary.totalFindings).toBe(7);
  });

  it("recognises a missing scan table through nested causes", () => {
    expect(isMissingScanTableError({ code: "42P01" })).toBe(true);
    expect(isMissingScanTableError(new Error("x", { cause: { code: "42P01" } }))).toBe(true);
    expect(isMissingScanTableError(new Error('relation "docker_image_security_scans" does not exist'))).toBe(true);
    expect(isMissingScanTableError(new Error("connection refused"))).toBe(false);
  });
});
