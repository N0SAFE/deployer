import z from 'zod/v4'
import {
  deploymentEnvironmentSchema,
  deploymentStatusSchema,
} from '@repo/contracts-common'
import { dockerListMetaSchema } from '../common.schema'
import { dockerContainerSchema } from './base.schema'

export const dockerContainerLinkPathSchema = z.enum([
  'deployment',
  'service',
  'project',
  'deployment.service',
  'service.project',
  'deployment.service.project',
])
export type DockerContainerLinkPath = z.infer<typeof dockerContainerLinkPathSchema>

export const dockerContainerLinkedProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseDomain: z.string().nullable(),
  updatedAt: z.string(),
  redactedFields: z.array(z.string()).default([]),
})
export type DockerContainerLinkedProject = z.infer<typeof dockerContainerLinkedProjectSchema>

export const dockerContainerLinkedServiceSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  isActive: z.boolean(),
  updatedAt: z.string(),
  customDomains: z.array(z.string()).default([]),
  resourceLimits: z
    .object({
      memory: z.string().optional(),
      cpu: z.string().optional(),
      storage: z.string().optional(),
    })
    .nullable(),
  environmentVariables: z.record(z.string(), z.string()).nullable(),
  redactedFields: z.array(z.string()).default([]),
})
export type DockerContainerLinkedService = z.infer<typeof dockerContainerLinkedServiceSchema>

export const dockerContainerLinkedDeploymentSchema = z.object({
  id: z.string().min(1),
  serviceId: z.string().min(1),
  projectId: z.string().min(1),
  environment: deploymentEnvironmentSchema,
  status: deploymentStatusSchema,
  containerName: z.string().nullable(),
  containerImage: z.string().nullable(),
  domainUrl: z.string().nullable(),
  healthCheckUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  redactedFields: z.array(z.string()).default([]),
})
export type DockerContainerLinkedDeployment = z.infer<typeof dockerContainerLinkedDeploymentSchema>

export const dockerContainerLinksSchema = z.object({
  deployment: dockerContainerLinkedDeploymentSchema.nullable(),
  service: dockerContainerLinkedServiceSchema.nullable(),
  project: dockerContainerLinkedProjectSchema.nullable(),
})
export type DockerContainerLinks = z.infer<typeof dockerContainerLinksSchema>

export const dockerContainerWithLinksSchema = dockerContainerSchema.extend({
  links: dockerContainerLinksSchema,
})
export type DockerContainerWithLinks = z.infer<typeof dockerContainerWithLinksSchema>

export const dockerContainerLinkedListSchema = z.object({
  data: z.array(dockerContainerWithLinksSchema),
  meta: dockerListMetaSchema,
})
export type DockerContainerLinkedList = z.infer<typeof dockerContainerLinkedListSchema>