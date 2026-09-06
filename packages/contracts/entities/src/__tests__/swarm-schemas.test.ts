import { describe, expect, it } from "vitest";
import {
    dockerodeSwarmInfoSchema,
    dockerodeServiceSummarySchema,
    dockerodeTaskSummarySchema,
    dockerodeNodeSummarySchema,
    swarmServiceSpecInputSchema,
} from "../index";

const serviceFixture = {
    ID: "abc123serviceid",
    Version: { Index: 7 },
    CreatedAt: "2026-09-03T00:00:00Z",
    UpdatedAt: "2026-09-03T00:00:00Z",
    Spec: {
        Name: "deployer-svc-1234567890ab-ab12cd34",
        Labels: { "deployer.managed": "true" },
        TaskTemplate: {
            ContainerSpec: { Image: "nginx:alpine", Labels: {} },
            Networks: [{ Target: "overlay-1", Aliases: [] }],
        },
        Mode: { Replicated: { Replicas: 2 } },
    },
    Endpoint: {
        VirtualIPs: [{ NetworkID: "net-1", Addr: "10.0.9.2/24" }],
    },
} as const;

const taskFixture = {
    ID: "task-1",
    Version: { Index: 3 },
    ServiceID: "abc123serviceid",
    NodeID: "node-1",
    Slot: 1,
    DesiredState: "running",
    Status: {
        State: "running",
        Timestamp: "2026-09-03T00:00:01Z",
        ContainerStatus: { ContainerID: "container-xyz", PID: 1234 },
    },
} as const;

const nodeFixture = {
    ID: "node-1",
    Version: { Index: 2 },
    CreatedAt: "2026-09-03T00:00:00Z",
    UpdatedAt: "2026-09-03T00:00:00Z",
    Spec: {
        Name: "host-a",
        Labels: { "deployer.ingress": "true" },
        Role: "manager",
        Availability: "active",
    },
    Description: {
        Hostname: "host-a",
        Platform: { Architecture: "arm64", OS: "linux" },
        Resources: { NanoCPUs: 8_000_000_000, MemoryBytes: 16_777_216_000 },
        Engine: { EngineVersion: "27.0.0" },
    },
    Status: { State: "ready", Addr: "10.0.0.5" },
    ManagerStatus: { Leader: true, Reachability: "reachable", Addr: "10.0.0.5:2377" },
} as const;

describe("swarm entity schemas", () => {
    it("parses a raw dockerode service summary", () => {
        const parsed = dockerodeServiceSummarySchema.parse(serviceFixture);
        expect(parsed.ID).toBe("abc123serviceid");
        expect(parsed.Version.Index).toBe(7);
        expect(parsed.Spec.Name).toBe("deployer-svc-1234567890ab-ab12cd34");
        expect(parsed.Spec.Labels["deployer.managed"]).toBe("true");
        expect(parsed.Spec.Mode?.Replicated?.Replicas).toBe(2);
        expect(parsed.UpdateStatus).toBeUndefined();
    });

    it("parses a raw dockerode task summary", () => {
        const parsed = dockerodeTaskSummarySchema.parse(taskFixture);
        expect(parsed.ServiceID).toBe("abc123serviceid");
        expect(parsed.Status.State).toBe("running");
        expect(parsed.Status.ContainerStatus?.ContainerID).toBe("container-xyz");
    });

    it("parses a raw dockerode node summary", () => {
        const parsed = dockerodeNodeSummarySchema.parse(nodeFixture);
        expect(parsed.Spec.Role).toBe("manager");
        expect(parsed.ManagerStatus?.Leader).toBe(true);
        expect(parsed.Description.Resources?.NanoCPUs).toBe(8_000_000_000);
        expect(parsed.Description.Engine?.EngineVersion).toBe("27.0.0");
    });

    it("tolerates additive engine fields via passthrough", () => {
        const extended = {
            ...serviceFixture,
            NextDigest: "sha256:…",
            PreviousSpec: { Name: "old-name" },
        };
        const parsed = dockerodeServiceSummarySchema.parse(extended);
        expect(parsed.ID).toBe("abc123serviceid");
    });

    it("round-trips the canonical spec input (defaults applied)", () => {
        const input = swarmServiceSpecInputSchema.parse({
            name: "svc-a",
            image: "nginx:alpine",
        });
        expect(input.replicas).toBe(1);
        expect(input.env).toEqual([]);
        expect(input.labels).toEqual({});
        expect(input.updateConfig.failureAction).toBe("rollback");
        expect(input.healthcheck).toBeNull();
    });

    it("parses GET /info Swarm payload for an ACTIVE engine", () => {
        const info = dockerodeSwarmInfoSchema.parse({
            NodeID: "node-1",
            NodeAddr: "10.0.0.1",
            LocalNodeState: "active",
            ControlAvailable: true,
            Error: "",
            RemoteManagers: [{ NodeID: "node-2", Addr: "10.0.0.2:2377" }],
            Nodes: 3,
            Managers: 3,
        });
        expect(info.LocalNodeState).toBe("active");
        expect(info.RemoteManagers).toHaveLength(1);
        expect(info.Nodes).toBe(3);
    });

    it("tolerates a NON-swarm engine (RemoteManagers null → inactive default)", () => {
        // Real docker output when the engine is not in swarm mode:
        // "Swarm": { "NodeID": "", "LocalNodeState": "inactive", …,
        //            "RemoteManagers": null, "Nodes": 0, "Managers": 0 }
        const info = dockerodeSwarmInfoSchema.parse({
            NodeID: "",
            NodeAddr: "",
            LocalNodeState: "inactive",
            ControlAvailable: false,
            Error: "",
            RemoteManagers: null,
            Nodes: 0,
            Managers: 0,
        });
        expect(info.LocalNodeState).toBe("inactive");
        expect(info.RemoteManagers).toBeNull();
    });

    it("defaults LocalNodeState to inactive when Swarm is absent", () => {
        const info = dockerodeSwarmInfoSchema.parse({});
        expect(info.LocalNodeState).toBe("inactive");
        expect(info.RemoteManagers).toBeNull();
    });
});