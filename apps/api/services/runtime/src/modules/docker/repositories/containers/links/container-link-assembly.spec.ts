import { describe, expect, it } from "vitest";

import { assembleContainerLinks, collectContainerLinkIds, inclusionOf, withoutLinks } from "./container-link-assembly";

const at = new Date("2026-10-01T00:00:00.000Z");
const container = (over: Record<string, unknown> = {}) =>
  ({
    id: "c1",
    hash: "h1",
    name: "api",
    projectId: "p1",
    serviceId: "s1",
    stackId: null,
    imageId: null,
    status: "running",
    health: "none",
    environment: null,
    cpuPercent: null,
    memoryPercent: null,
    restartCount: 0,
    ports: [],
    networkIds: [],
    volumeIds: [],
    managedBy: "orphan",
    managedReason: null,
    managedDeploymentId: null,
    managedServiceId: null,
    managedProjectId: null,
    managedImageRef: null,
    managedNetworkMode: null,
    logsStreamId: "d1",
    startedAt: null,
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
    ...over,
  }) as never;

describe("container link assembly", () => {
  it("collects the ids each included link needs", () => {
    const include = inclusionOf(["deployment", "project"]);
    const ids = collectContainerLinkIds([container()], include);
    expect([...ids.deploymentIds]).toEqual(["d1"]);
    expect([...ids.serviceIds]).toEqual([]);
    expect([...ids.projectIds]).toEqual(["p1"]);
  });

  it("falls back from the container's own ids to the ones its deployment and service name", () => {
    const rows = {
      deployments: [
        {
          id: "d1", serviceId: "s9", projectId: "p9", environment: "preview", status: "success",
          containerName: null, containerImage: null, domainUrl: null, healthCheckUrl: null, createdAt: at, updatedAt: at,
        },
      ],
      services: [
        {
          id: "s9", projectId: "p9", name: "svc", type: "web", isActive: true, updatedAt: at,
          customDomains: [], resourceLimits: null, environmentVariables: null,
        },
      ],
      projects: [{ id: "p9", name: "proj", baseDomain: null, updatedAt: at }],
    };
    const [linked] = assembleContainerLinks(
      [container({ serviceId: "unknown", projectId: "unknown" })],
      inclusionOf(["deployment.service.project"]),
      "admin",
      rows,
    );
    expect(linked?.links.deployment?.id).toBe("d1");
    expect(linked?.links.service?.id).toBe("s9");
    expect(linked?.links.project?.id).toBe("p9");
  });

  it("gives every container empty links when nothing is included", () => {
    expect(withoutLinks([container()])[0]?.links).toEqual({ deployment: null, service: null, project: null });
  });
});
