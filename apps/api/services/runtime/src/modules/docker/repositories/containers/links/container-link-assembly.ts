/**
 * Which linked rows a set of containers needs, and how the rows become each container's links. Pure: the
 * lookup that fetches the rows is a separate Effect repository, so the assembly is tested on plain data.
 */
import {
  dockerContainerWithLinksSchema,
  type DockerContainer,
  type DockerContainerLinkPath,
  type DockerContainerWithLinks,
} from "@deployer/contracts-entities";

import {
  deploymentLinkFromRecord,
  projectLinkFromRecord,
  resolveRoleTier,
  serviceLinkFromRecord,
  shouldIncludeDeployment,
  shouldIncludeProject,
  shouldIncludeService,
  type ContainerLinkedDeploymentRecord,
  type ContainerLinkedProjectRecord,
  type ContainerLinkedServiceRecord,
} from "./container-link-redaction";

/** A linked deployment row also names the project it belongs to (through its service). */
export type LinkedDeploymentRow = ContainerLinkedDeploymentRecord;

export type LinkInclusion = {
  readonly deployment: boolean;
  readonly service: boolean;
  readonly project: boolean;
};

export function inclusionOf(paths: readonly DockerContainerLinkPath[]): LinkInclusion {
  const set = new Set(paths);
  return {
    deployment: shouldIncludeDeployment(set),
    service: shouldIncludeService(set),
    project: shouldIncludeProject(set),
  };
}

/** The ids the containers name themselves; the rows found for them name more (deployment -> service -> project). */
export function collectContainerLinkIds(containers: readonly DockerContainer[], include: LinkInclusion) {
  const deploymentIds = new Set<string>();
  const serviceIds = new Set<string>();
  const projectIds = new Set<string>();

  for (const container of containers) {
    if (include.deployment && container.logsStreamId) deploymentIds.add(container.logsStreamId);
    if (include.service && container.serviceId) serviceIds.add(container.serviceId);
    if (include.project && container.projectId) projectIds.add(container.projectId);
  }

  return { deploymentIds, serviceIds, projectIds };
}

export type ContainerLinkRows = {
  readonly deployments: readonly LinkedDeploymentRow[];
  readonly services: readonly ContainerLinkedServiceRecord[];
  readonly projects: readonly ContainerLinkedProjectRecord[];
};

const emptyLinks = { deployment: null, service: null, project: null };

export function withoutLinks(containers: readonly DockerContainer[]): DockerContainerWithLinks[] {
  return containers.map((container) => dockerContainerWithLinksSchema.parse({ ...container, links: emptyLinks }));
}

export function assembleContainerLinks(
  containers: readonly DockerContainer[],
  include: LinkInclusion,
  platformRole: string | null,
  rows: ContainerLinkRows,
): DockerContainerWithLinks[] {
  const roleTier = resolveRoleTier(platformRole);
  const deploymentsById = new Map(rows.deployments.map((row) => [row.id, row]));
  const servicesById = new Map(rows.services.map((row) => [row.id, row]));
  const projectsById = new Map(rows.projects.map((row) => [row.id, row]));

  return containers.map((container) => {
    const deploymentRecord =
      include.deployment && container.logsStreamId ? deploymentsById.get(container.logsStreamId) : undefined;

    const serviceRecord = include.service
      ? (servicesById.get(container.serviceId)
        ?? (deploymentRecord ? servicesById.get(deploymentRecord.serviceId) : undefined))
      : undefined;

    const projectRecord = include.project
      ? (projectsById.get(container.projectId)
        ?? (serviceRecord ? projectsById.get(serviceRecord.projectId) : undefined)
        ?? (deploymentRecord ? projectsById.get(deploymentRecord.projectId) : undefined))
      : undefined;

    return dockerContainerWithLinksSchema.parse({
      ...container,
      links: {
        deployment: deploymentRecord ? deploymentLinkFromRecord(deploymentRecord, roleTier) : null,
        service: serviceRecord ? serviceLinkFromRecord(serviceRecord, roleTier) : null,
        project: projectRecord ? projectLinkFromRecord(projectRecord, roleTier) : null,
      },
    });
  });
}
