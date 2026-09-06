import { describe, expect, it } from "vitest";
import type Docker from "dockerode";
import type { SwarmServiceSpecInput } from "@repo/contracts-entities";
import { toDockerServiceSpec } from "./swarm-spec.mapper";

/** Narrow the TaskTemplate discriminated union to the container variant. */
function containerSpec(spec: Docker.ServiceSpec): Docker.ContainerSpec | undefined {
    const task = spec.TaskTemplate;
    return task && "ContainerSpec" in task ? task.ContainerSpec : undefined;
}

const baseInput: SwarmServiceSpecInput = {
    name: "deployer-svc-1234567890ab-ab12cd34",
    image: "nginx:alpine",
    replicas: 2,
    env: ["FOO=bar", "BAZ=qux"],
    command: [],
    args: ["sh", "-lc", "npm start"],
    labels: { "deployer.managed": "true", "traefik.enable": "true" },
    containerLabels: { "com.example.label": "value" },
    mounts: [],
    placementPreferences: [{ spreadDescriptor: "node.labels.deployer.node.role" }],
    placementConstraints: [],
    resourcesLimits: { nanoCpus: 2_000_000_000, memoryBytes: 1_073_741_824 },
    resourcesReservations: {},
    networks: ["deployer-project-1"],
    healthcheck: {
        test: ["CMD-SHELL", "wget --spider http://localhost:3000/health || exit 1"],
        intervalMs: 5_000,
        timeoutMs: 2_000,
        retries: 3,
        startPeriodMs: 1_000,
    },
    updateConfig: { parallelism: 1, delayMs: 0, order: "start-first", failureAction: "rollback" },
    endpointPorts: [{ targetPort: 3000, publishedPort: 8080, protocol: "tcp" }],
};

describe("toDockerServiceSpec", () => {
    it("maps the canonical spec to a dockerode ServiceSpec", () => {
        const spec = toDockerServiceSpec(baseInput);
        const container = containerSpec(spec);

        expect(spec.Name).toBe("deployer-svc-1234567890ab-ab12cd34");
        expect(spec.Labels?.["deployer.managed"]).toBe("true");
        expect(container?.Image).toBe("nginx:alpine");
        expect(container?.Env).toEqual(["FOO=bar", "BAZ=qux"]);
        expect(container?.Args).toEqual(["sh", "-lc", "npm start"]);
        expect(container?.Labels).toEqual({ "com.example.label": "value" });
        expect(spec.Mode).toEqual({ Replicated: { Replicas: 2 } });
    });

    it("converts health intervals from ms to nanoseconds", () => {
        const spec = toDockerServiceSpec(baseInput);
        expect(containerSpec(spec)?.HealthCheck).toMatchObject({
            Interval: 5_000 * 1_000_000,
            Timeout: 2_000 * 1_000_000,
            StartPeriod: 1_000 * 1_000_000,
            Retries: 3,
        });
    });

    it("maps resources + placement + networks", () => {
        const spec = toDockerServiceSpec(baseInput);
        expect(spec.TaskTemplate?.Resources?.Limits).toEqual({
            NanoCPUs: 2_000_000_000,
            MemoryBytes: 1_073_741_824,
        });
        expect(spec.TaskTemplate?.Placement?.Preferences).toEqual([
            { Spread: { SpreadDescriptor: "node.labels.deployer.node.role" } },
        ]);
        expect(spec.TaskTemplate?.Networks).toEqual([{ Target: "deployer-project-1" }]);
    });

    it("maps update/rollback config with ns delay", () => {
        const spec = toDockerServiceSpec({
            ...baseInput,
            updateConfig: { parallelism: 2, delayMs: 250, order: "stop-first", failureAction: "pause" },
            rollbackConfig: { parallelism: 1, delayMs: 500, order: "stop-first", failureAction: "pause" },
        });
        expect(spec.UpdateConfig).toEqual({
            Parallelism: 2,
            Delay: 250 * 1_000_000,
            Order: "stop-first",
            FailureAction: "pause",
        });
        expect(spec.RollbackConfig?.Delay).toBe(500 * 1_000_000);
    });

    it("maps endpoint ports", () => {
        const spec = toDockerServiceSpec(baseInput);
        expect(spec.EndpointSpec?.Ports).toEqual([
            { TargetPort: 3000, PublishedPort: 8080, Protocol: "tcp" },
        ]);
    });

    it("maps volume mounts and omits empty placements", () => {
        const spec = toDockerServiceSpec({
            ...baseInput,
            placementPreferences: [],
            placementConstraints: ["node.role == worker"],
            mounts: [
                { type: "volume", source: "deployer-storage-depl-1", target: "/data", readOnly: false },
            ],
        });
        expect(containerSpec(spec)?.Mounts).toEqual([
            { Type: "volume", Source: "deployer-storage-depl-1", Target: "/data", ReadOnly: false },
        ]);
        expect(spec.TaskTemplate?.Placement?.Preferences).toBeUndefined();
        expect(spec.TaskTemplate?.Placement?.Constraints).toEqual(["node.role == worker"]);
    });
});