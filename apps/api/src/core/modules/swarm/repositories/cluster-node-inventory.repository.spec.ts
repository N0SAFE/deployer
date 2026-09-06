import { describe, expect, it } from "vitest";
import type { DockerodeNodeSummary } from "@repo/contracts-entities";
import { toEngineNodeRow } from "./cluster-node-inventory.repository";

const node = (overrides: Partial<DockerodeNodeSummary> = {}): DockerodeNodeSummary =>
    ({
        ID: "node-1",
        Version: { Index: 1 },
        CreatedAt: "2026-09-04T00:00:00Z",
        UpdatedAt: "2026-09-04T00:00:00Z",
        Spec: {
            Name: "node-1",
            Labels: {},
            Role: "worker",
            Availability: "active",
        },
        Description: {
            Hostname: "host-1",
            Resources: { NanoCPUs: 4_000_000_000, MemoryBytes: 8_589_934_592 },
        },
        Status: { State: "ready" },
        ManagerStatus: null,
        ...overrides,
    }) as DockerodeNodeSummary;

describe("toEngineNodeRow", () => {
    it("maps a worker node with defaults", () => {
        const row = toEngineNodeRow(node());
        expect(row).toMatchObject({
            nodeId: "node-1",
            hostname: "host-1",
            swarmRole: "worker",
            platformRole: "both",
            isLeader: false,
            isIngress: false,
            availability: "active",
            nanoCpus: 4_000_000_000,
            memoryBytes: 8_589_934_592,
        });
    });

    it("maps a raft leader manager", () => {
        const row = toEngineNodeRow(
            node({
                Spec: { Name: "m1", Labels: {}, Role: "manager", Availability: "pause" },
                ManagerStatus: { Leader: true, Reachability: "reachable" },
            }),
        );
        expect(row.swarmRole).toBe("manager");
        expect(row.isLeader).toBe(true);
        expect(row.availability).toBe("pause");
    });

    it("derives isIngress from the deployer.ingress label", () => {
        const row = toEngineNodeRow(
            node({ Spec: { Name: "n", Labels: { "deployer.ingress": "true" }, Role: "worker", Availability: "active" } }),
        );
        expect(row.isIngress).toBe(true);
    });

    it("tolerates missing resources", () => {
        const row = toEngineNodeRow(node({ Description: { Hostname: "h" } }));
        expect(row.nanoCpus).toBeNull();
        expect(row.memoryBytes).toBeNull();
    });
});