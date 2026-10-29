import { describe, expect, it } from "vitest";

import {
	buildScanEvent,
	mergeVulnerabilityEntries,
	parseByteValue,
	parseDiveLayerEfficiency,
	parseGrypeVulnerabilities,
	parseTrivyVulnerabilities,
	splitScannerOutputLines,
} from "./scanner-output";

const trivyReport = (vulnerabilities: unknown[]) => JSON.stringify({ Results: [{ Target: "app", Vulnerabilities: vulnerabilities }] });

describe("parseTrivyVulnerabilities", () => {
	it("reads the vulnerabilities of every result", () => {
		const entries = parseTrivyVulnerabilities(
			trivyReport([
				{ VulnerabilityID: "CVE-1", PkgName: "openssl", InstalledVersion: "1.0", FixedVersion: "1.1", Severity: "CRITICAL", Title: "bad" },
				{ VulnerabilityID: "CVE-2", PkgName: "zlib", InstalledVersion: "2.0", Severity: "LOW", Description: "meh" },
			]),
		);

		expect(entries).toEqual([
			expect.objectContaining({ id: "CVE-1", severity: "critical", packageName: "openssl", currentVersion: "1.0", fixedVersion: "1.1", description: "bad", scannerSources: ["trivy"] }),
			expect.objectContaining({ id: "CVE-2", severity: "low", fixedVersion: null, description: "meh" }),
		]);
	});

	it("drops records it cannot identify and tolerates garbage", () => {
		expect(parseTrivyVulnerabilities(trivyReport([{ PkgName: "x", InstalledVersion: "1", Severity: "HIGH" }, { VulnerabilityID: "CVE-9", PkgName: "y", InstalledVersion: "1", Severity: "UNKNOWN" }, null]))).toEqual([]);
		expect(parseTrivyVulnerabilities("not json")).toEqual([]);
		expect(parseTrivyVulnerabilities("42")).toEqual([]);
		expect(parseTrivyVulnerabilities(JSON.stringify({ Results: "nope" }))).toEqual([]);
	});
});

describe("parseGrypeVulnerabilities", () => {
	it("reads a match's vulnerability and artifact", () => {
		const entries = parseGrypeVulnerabilities(
			JSON.stringify({
				matches: [{ vulnerability: { id: "GHSA-1", severity: "High", fix: { versions: ["3.1"] }, description: "d" }, artifact: { name: "libx", version: "3.0" } }],
			}),
		);
		expect(entries).toEqual([expect.objectContaining({ id: "GHSA-1", severity: "high", packageName: "libx", currentVersion: "3.0", scannerSources: ["grype"] })]);
	});

	it("is empty for output that is not a Grype report", () => {
		expect(parseGrypeVulnerabilities("oops")).toEqual([]);
		expect(parseGrypeVulnerabilities(JSON.stringify({ matches: [{}] }))).toEqual([]);
	});
});

describe("mergeVulnerabilityEntries", () => {
	it("merges the same vulnerability found by both scanners and keeps the higher severity", () => {
		const merged = mergeVulnerabilityEntries([
			{ id: "CVE-1", severity: "medium", packageName: "p", currentVersion: "1", fixedVersion: null, description: "a", scannerSources: ["trivy"] },
			{ id: "CVE-1", severity: "high", packageName: "p", currentVersion: "1", fixedVersion: "2", description: "a", scannerSources: ["grype"] },
		]);

		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({ severity: "high", fixedVersion: "2" });
		expect([...(merged[0]?.scannerSources ?? [])].sort()).toEqual(["grype", "trivy"]);
	});
});

describe("parseDiveLayerEfficiency", () => {
	it("reads the efficiency score and the wasted space", () => {
		const result = parseDiveLayerEfficiency("Image efficiency score: 96.5 %\nWasted space: 3.5%\nPotential wasted space: 12 MiB\nlayer 3 is large");
		expect(result).toMatchObject({ efficiencyScore: 96.5, estimatedWastedPercent: 3.5, estimatedWastedBytes: 12 * 1_048_576 });
		expect(result?.notes.length).toBeGreaterThan(0);
	});

	it("is null for empty or unrelated output", () => {
		expect(parseDiveLayerEfficiency("   ")).toBeNull();
		expect(parseDiveLayerEfficiency("nothing to see here")).toBeNull();
	});
});

describe("parseByteValue", () => {
	it("understands decimal and binary units", () => {
		expect(parseByteValue("2", "KB")).toBe(2_000);
		expect(parseByteValue("2", "kib")).toBe(2_048);
		expect(parseByteValue("1.5", "GiB")).toBe(1.5 * 1_073_741_824);
	});

	it("rejects negatives, NaN and unknown units", () => {
		expect(parseByteValue("-1", "mb")).toBeNull();
		expect(parseByteValue("abc", "mb")).toBeNull();
		expect(parseByteValue("1", "parsec")).toBeNull();
	});
});

describe("splitScannerOutputLines and buildScanEvent", () => {
	it("splits on any newline style and drops blanks", () => {
		expect(splitScannerOutputLines("a\r\nb\rc\n\n  d  \n")).toEqual(["a", "b", "c", "d"]);
	});

	it("builds a progress event with the given stage and message", () => {
		const event = buildScanEvent({ imageId: "sha256:x", type: "status", stage: "queued", scanner: null, progress: 0, message: "Queued security scan", logLine: null });
		expect(event).toMatchObject({ imageId: "sha256:x", type: "status", stage: "queued", progress: 0, message: "Queued security scan" });
	});
});
