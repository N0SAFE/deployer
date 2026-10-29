import { describe, expect, it } from "vitest";

import {
	inferRuntimeActivitySeverity,
	inferRuntimeActivityStatus,
	toNullableNonEmptyString,
	toProgress,
	toTimestampDate,
} from "./runtime-activity-mapping";

describe("runtime activity mapping", () => {
	it("derives the status from the action and the scan state", () => {
		expect(inferRuntimeActivityStatus("scan.queued")).toBe("queued");
		expect(inferRuntimeActivityStatus("scan.run", "error")).toBe("error");
		expect(inferRuntimeActivityStatus("pull.failed")).toBe("error");
		expect(inferRuntimeActivityStatus("scan.done")).toBe("completed");
		expect(inferRuntimeActivityStatus("image.pull")).toBe("running");
		expect(inferRuntimeActivityStatus("container.health")).toBe("info");
	});

	it("derives the severity from the action", () => {
		expect(inferRuntimeActivitySeverity("scan.error")).toBe("error");
		expect(inferRuntimeActivitySeverity("container.start")).toBe("info");
	});

	it("reads loose values defensively", () => {
		expect(toNullableNonEmptyString("  x ")).toBe("x");
		expect(toNullableNonEmptyString("   ")).toBeNull();
		expect(toNullableNonEmptyString(5)).toBeNull();
		expect(toTimestampDate("not a date")).toBeNull();
		expect(toTimestampDate("2026-10-01T00:00:00.000Z")?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
		expect(toProgress(undefined)).toBeNull();
		expect(toProgress("42")).toBe(42);
	});
});
