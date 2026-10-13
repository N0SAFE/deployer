import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { deployments } from "@deployer/nest-schema/global/runtime/deployment";
import { projectCollaborators, projects, services } from "@deployer/nest-schema/global/project/deployment";

export const deploymentSelectSchema = createSelectSchema(deployments)


export const deploymentInsertSchema = createInsertSchema(deployments)


export const deploymentUpdateSchema = createUpdateSchema(deployments)
