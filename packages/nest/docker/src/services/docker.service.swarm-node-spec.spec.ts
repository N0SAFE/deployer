/**
 * `DockerService.buildSwarmNodeSpecPayload` — the FLAT NodeSpec body sent to
 * `POST /nodes/{id}/update`.
 *
 * Two engine-verified failure modes are pinned here because this shape is only
 * otherwise reachable through a live daemon, which is exactly why both shipped:
 *
 *   1. a nested `Spec` wrapper → the daemon read an empty top-level Role and
 *      rejected EVERY node update with `400 invalid Role: ""`;
 *   2. merging the request over the existing labels → a label the caller
 *      deliberately dropped came back, so `platformRole` could never be reverted
 *      to `both` (the update returned 200, the engine kept the old key, and the
 *      next inventory sweep read the old role back).
 */

import { describe, expect, it } from "vitest";
import type { DockerodeNodeSummary } from "@repo/contracts-entities";
import { DockerService } from "./docker.service";

/** The node's current labels, as every caller reads them to build the desired set. */
const CURRENT_LABELS = { "deployer.ingress": "true", "deployer.node.role": "control" };

/**
 * A node summary with the fields this payload builder consumes.
 * `Spec` is Partial only to express runtime values the engine's own types forbid
 * (an empty `Role` after init) — the builder must tolerate them, not echo them.
 */
const node = (spec: Partial<DockerodeNodeSummary["Spec"]> = {}): DockerodeNodeSummary =>
	({
		ID: "node-1",
		Version: { Index: 7 },
		Spec: {
			Name: "node-1",
			Role: "manager",
			Availability: "active",
			Labels: CURRENT_LABELS,
			...spec,
		},
		Description: { Hostname: "node-1" },
		ManagerStatus: { Leader: true, Reachability: "reachable" },
	}) as DockerodeNodeSummary;

describe("buildSwarmNodeSpecPayload", () => {
	it("returns a FLAT spec (no nested `Spec` wrapper) with the top-level Role set", () => {
		const payload = DockerService.buildSwarmNodeSpecPayload(node(), {});

		expect(payload).not.toHaveProperty("Spec");
		expect(payload.Role).toBe("manager");
		expect(payload.Name).toBe("node-1");
	});

	it("REPLACES the label map with the caller's complete desired set (removal works)", () => {
		// `withPlatformRole(labels, "both")` drops the role key entirely.
		const payload = DockerService.buildSwarmNodeSpecPayload(node(), {
			labels: { "deployer.ingress": "true" },
		});

		expect(payload.Labels).toEqual({ "deployer.ingress": "true" });
		expect(payload.Labels).not.toHaveProperty("deployer.node.role");
	});

	it("inherits the current labels when only role/availability change", () => {
		const payload = DockerService.buildSwarmNodeSpecPayload(node(), {
			role: "worker",
			availability: "drain",
		});

		expect(payload.Labels).toEqual({
			"deployer.ingress": "true",
			"deployer.node.role": "control",
		});
		expect(payload.Role).toBe("worker");
		expect(payload.Availability).toBe("drain");
	});

	it("keeps the current role/availability when they are not overridden", () => {
		const payload = DockerService.buildSwarmNodeSpecPayload(node(), {
			labels: { "deployer.ingress": "true" },
		});

		expect(payload.Role).toBe("manager");
		expect(payload.Availability).toBe("active");
	});

	it("never guesses a manager as worker when Spec.Role is transiently empty", () => {
		// A transient post-init payload reports `Role: ""`, which the engine's own
		// types forbid — demoting a manager to worker can leave the cluster with
		// no manager at all, so the empty value must be tolerated, not echoed.
		const payload = DockerService.buildSwarmNodeSpecPayload(node({ Role: "" }), {});

		expect(payload.Role).toBe("manager");
	});

	it("defaults availability to active when the engine reports an unknown value", () => {
		const payload = DockerService.buildSwarmNodeSpecPayload(node({ Availability: "" }), {});

		expect(payload.Availability).toBe("active");
	});

	it("falls back to an empty label map when the node has none", () => {
		const payload = DockerService.buildSwarmNodeSpecPayload(node({ Labels: undefined }), {});

		expect(payload.Labels).toEqual({});
	});
});
