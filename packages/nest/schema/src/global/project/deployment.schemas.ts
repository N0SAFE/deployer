import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { deployments } from "@deployer/nest-schema/global/runtime/deployment";
import { projectCollaborators, projects, services } from "@deployer/nest-schema/global/project/deployment";

export const projectSelectSchema = createSelectSchema(projects)


export const projectInsertSchema = createInsertSchema(projects)


export const projectUpdateSchema = createUpdateSchema(projects)



export const serviceSelectSchema = createSelectSchema(services)


export const serviceInsertSchema = createInsertSchema(services)


export const serviceUpdateSchema = createUpdateSchema(services)



export const projectCollaboratorSelectSchema = createSelectSchema(projectCollaborators)


export const projectCollaboratorInsertSchema = createInsertSchema(projectCollaborators)


export const projectCollaboratorUpdateSchema = createUpdateSchema(projectCollaborators)
