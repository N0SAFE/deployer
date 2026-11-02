/**
 * What a container's linked deployment, service and project look like per role: the viewer, developer and
 * admin tiers each see more, and a field a tier may not see is dropped and named in `redactedFields`.
 * Pure, so the redaction rules are tested without a database.
 */
import {
  dockerContainerLinkedDeploymentSchema,
  dockerContainerLinkedProjectSchema,
  dockerContainerLinkedServiceSchema,
  type DockerContainerLinkPath,
} from "@deployer/contracts-entities";

import z from "zod/v4";

export type DockerRoleTier = "admin" | "developer" | "viewer";

export type ContainerLinkedDeploymentRecord = {
  id: string;
  serviceId: string;
  projectId: string;
  environment: string;
  status: string;
  containerName: string | null;
  containerImage: string | null;
  domainUrl: string | null;
  healthCheckUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ContainerLinkedServiceRecord = {
  id: string;
  projectId: string;
  name: string;
  type: string;
  isActive: boolean;
  updatedAt: Date;
  customDomains: unknown;
  resourceLimits: unknown;
  environmentVariables: unknown;
}

export type ContainerLinkedProjectRecord = {
  id: string;
  name: string;
  baseDomain: string | null;
  updatedAt: Date;
}

export function resolveRoleTier(platformRole: string | null): DockerRoleTier {
  const normalized = (platformRole ?? "").trim().toLowerCase();

  if (["superadmin", "super_admin", "admin", "owner"].includes(normalized)) {
    return "admin";
  }

  if (["developer", "deployer", "maintainer"].includes(normalized)) {
    return "developer";
  }

  return "viewer";
}

export function normalizeResourceLimits(
  value: unknown,
): { memory?: string; cpu?: string; storage?: string } | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  // Use `in` + `typeof` narrowing instead of a `Record<string, unknown>`
  // cast — the truth comes from the runtime check, not a type lie.
  const memory =
    "memory" in value && typeof value.memory === "string" ? value.memory : undefined;
  const cpu =
    "cpu" in value && typeof value.cpu === "string" ? value.cpu : undefined;
  const storage =
    "storage" in value && typeof value.storage === "string"
      ? value.storage
      : undefined;

  if (!memory && !cpu && !storage) {
    return null;
  }

  return { memory, cpu, storage };
}

export function normalizeEnvironmentVariables(value: unknown): Record<string, string> | null {
  // Shape validation through Zod — a record keyed by non-empty strings.
  const parsed = z.record(z.string().min(1), z.string()).safeParse(value);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return null;
  }
  return parsed.data;
}

export function normalizeCustomDomains(value: unknown): string[] {
  // Shape validation through Zod — array of non-empty strings.
  const parsed = z.array(z.string().min(1)).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function shouldIncludeDeployment(includeSet: Set<DockerContainerLinkPath>): boolean {
  return (
    includeSet.has("deployment")
    || includeSet.has("deployment.service")
    || includeSet.has("deployment.service.project")
  );
}

export function shouldIncludeService(includeSet: Set<DockerContainerLinkPath>): boolean {
  return (
    includeSet.has("service")
    || includeSet.has("service.project")
    || includeSet.has("deployment.service")
    || includeSet.has("deployment.service.project")
  );
}

export function shouldIncludeProject(includeSet: Set<DockerContainerLinkPath>): boolean {
  return (
    includeSet.has("project")
    || includeSet.has("service.project")
    || includeSet.has("deployment.service.project")
  );
}

export function projectLinkFromRecord(
  record: ContainerLinkedProjectRecord,
  roleTier: DockerRoleTier,
) {
  const redactedFields: string[] = [];
  let baseDomain = record.baseDomain;

  if (roleTier === "viewer") {
    redactedFields.push("baseDomain");
    baseDomain = null;
  }

  return dockerContainerLinkedProjectSchema.parse({
    id: record.id,
    name: record.name,
    baseDomain,
    updatedAt: record.updatedAt.toISOString(),
    redactedFields,
  });
}

export function serviceLinkFromRecord(
  record: ContainerLinkedServiceRecord,
  roleTier: DockerRoleTier,
) {
  const redactedFields: string[] = [];
  let resourceLimits = normalizeResourceLimits(record.resourceLimits);
  let environmentVariables = normalizeEnvironmentVariables(record.environmentVariables);

  if (roleTier === "viewer") {
    if (resourceLimits) redactedFields.push("resourceLimits");
    if (environmentVariables) redactedFields.push("environmentVariables");
    resourceLimits = null;
    environmentVariables = null;
  }

  if (roleTier === "developer") {
    if (environmentVariables) redactedFields.push("environmentVariables");
    environmentVariables = null;
  }

  return dockerContainerLinkedServiceSchema.parse({
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    type: record.type,
    isActive: record.isActive,
    updatedAt: record.updatedAt.toISOString(),
    customDomains: normalizeCustomDomains(record.customDomains),
    resourceLimits,
    environmentVariables,
    redactedFields,
  });
}

export function deploymentLinkFromRecord(
  record: ContainerLinkedDeploymentRecord,
  roleTier: DockerRoleTier,
) {
  const redactedFields: string[] = [];
  let domainUrl = record.domainUrl;
  let healthCheckUrl = record.healthCheckUrl;

  if (roleTier === "viewer") {
    if (domainUrl) redactedFields.push("domainUrl");
    if (healthCheckUrl) redactedFields.push("healthCheckUrl");
    domainUrl = null;
    healthCheckUrl = null;
  }

  if (roleTier === "developer" && record.environment === "production") {
    if (domainUrl) redactedFields.push("domainUrl");
    if (healthCheckUrl) redactedFields.push("healthCheckUrl");
    domainUrl = null;
    healthCheckUrl = null;
  }

  return dockerContainerLinkedDeploymentSchema.parse({
    id: record.id,
    serviceId: record.serviceId,
    projectId: record.projectId,
    environment: record.environment,
    status: record.status,
    containerName: record.containerName,
    containerImage: record.containerImage,
    domainUrl,
    healthCheckUrl,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    redactedFields,
  });
}
