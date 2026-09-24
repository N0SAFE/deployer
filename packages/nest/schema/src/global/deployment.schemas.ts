import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { deployments, projectCollaborators, projects, services } from './deployment'

export const projectSelectSchema = createSelectSchema(projects)
export const projectInsertSchema = createInsertSchema(projects)
export const projectUpdateSchema = createUpdateSchema(projects)

export const serviceSelectSchema = createSelectSchema(services)
export const serviceInsertSchema = createInsertSchema(services)
export const serviceUpdateSchema = createUpdateSchema(services)

export const deploymentSelectSchema = createSelectSchema(deployments)
export const deploymentInsertSchema = createInsertSchema(deployments)
export const deploymentUpdateSchema = createUpdateSchema(deployments)

export const projectCollaboratorSelectSchema = createSelectSchema(projectCollaborators)
export const projectCollaboratorInsertSchema = createInsertSchema(projectCollaborators)
export const projectCollaboratorUpdateSchema = createUpdateSchema(projectCollaborators)