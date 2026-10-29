import { describe, expect, it } from "vitest";

import {
	buildRuntimeActivityRecord,
	toRuntimeActivityEntity,
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

	it("chains image scan runs to their queue entry and de-duplicates on a fingerprint", () => {
		const now = new Date("2026-10-02T00:00:00.000Z");
		const event = {
			type: "docker_event",
			eventId: "e1",
			scope: null,
			from: null,
			nodeId: null,
			timestampNano: null,
			source: "image",
			action: "scan_start",
			actorId: " img-1 ",
			timestamp: "2026-10-01T00:00:00.000Z",
			actorAttributes: { scanProgress: "10", scanScanner: "trivy" },
			payload: { imageId: "img-1", imageName: null, repository: null, tag: null },
			raw: {},
		} as never;

		const record = buildRuntimeActivityRecord(event, now);
		expect(record.flowId).toBe("image-scan-run:img-1");
		expect(record.dependsOnFlowId).toBe("image-scan-queue:img-1");
		expect(record.category).toBe("image-scanning");
		expect(record.progress).toBe(10);
		expect(record.scanner).toBe("trivy");
		expect(record.occurredAt.toISOString()).toBe("2026-10-01T00:00:00.000Z");
		expect(buildRuntimeActivityRecord(event, now).eventFingerprint).toBe(record.eventFingerprint);
		expect(buildRuntimeActivityRecord({ ...(event as object), action: "scan_queued" } as never, now).dependsOnFlowId).toBeNull();
	});

	it("rehydrates a persisted row without live swarm state", () => {
		const at = new Date("2026-10-01T00:00:00.000Z");
		const entity = toRuntimeActivityEntity({
			id: "00000000-0000-4000-8000-000000000001",
			eventId: null,
			eventFingerprint: "f",
			flowId: "x:1",
			dependsOnFlowId: null,
			source: "bogus",
			action: "a",
			actorId: null,
			status: "info",
			category: "runtime-event",
			severity: "info",
			progress: null,
			stage: null,
			scanner: null,
			message: null,
			actorAttributes: {},
			payload: {},
			raw: {},
			occurredAt: at,
			createdAt: at,
			updatedAt: at,
		});
		expect(entity.source).toBe("unknown");
		expect(entity.swarmTasks).toEqual([]);
		expect(entity.swarmService).toBeNull();
	});
});
