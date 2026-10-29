/**
 * Containers grouped into the stacks they belong to (compose project, swarm stack namespace, or "standalone"),
 * with a stack's status worsening as its containers do. Pure, so grouping is tested without an engine.
 */
import { dockerStackSchema, type DockerContainer, type DockerStack } from "@deployer/contracts-entities";

export function stackNameOf(labels: Readonly<Record<string, string>>): string {
  return labels["com.docker.compose.project"] ?? labels["com.docker.stack.namespace"] ?? "standalone";
}

function initialStatus(status: DockerContainer["status"]): DockerStack["status"] {
  if (status === "running") return "healthy";
  if (status === "exited" || status === "dead") return "failed";
  return "degraded";
}

export function groupContainersIntoStacks(
  entries: readonly { readonly stackName: string; readonly container: DockerContainer }[],
  now: string,
): DockerStack[] {
  const grouped = new Map<string, DockerStack>();

  for (const { stackName, container } of entries) {
    const serviceRef = {
      serviceId: container.serviceId,
      imageId: container.imageId,
      containerIds: [container.id],
      networkIds: container.networkIds,
      volumeIds: container.volumeIds,
      replicas: 1,
      desiredReplicas: 1,
      status: container.status,
    } as const;

    const existing = grouped.get(stackName);
    if (!existing) {
      grouped.set(
        stackName,
        dockerStackSchema.parse({
          id: stackName,
          name: stackName,
          projectId: container.projectId,
          status: initialStatus(container.status),
          services: [serviceRef],
          networkIds: [...serviceRef.networkIds],
          volumeIds: [...serviceRef.volumeIds],
          labels: {},
          createdAt: container.createdAt,
          updatedAt: now,
        }),
      );
      continue;
    }

    // A stack that has failed stays failed; a dead or exited container fails it; otherwise it keeps its status.
    const nextStatus =
      existing.status === "failed" || container.status === "dead" || container.status === "exited"
        ? "failed"
        : existing.status;

    grouped.set(
      stackName,
      dockerStackSchema.parse({
        ...existing,
        status: nextStatus,
        services: [...existing.services, serviceRef],
        networkIds: [...new Set([...existing.networkIds, ...serviceRef.networkIds])],
        volumeIds: [...new Set([...existing.volumeIds, ...serviceRef.volumeIds])],
        updatedAt: now,
      }),
    );
  }

  return [...grouped.values()];
}
