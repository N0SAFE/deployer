import {
    createInsertSchema,
    createSelectSchema,
    createUpdateSchema,
} from 'drizzle-zod'

import { projectCollaborators } from '@deployer/nest-schema/global/project/deployment'
import { deployments } from '@deployer/nest-schema/global/runtime/deployment'

export const deploymentSelectSchema = createSelectSchema(deployments)

export const deploymentInsertSchema = createInsertSchema(deployments)

export const deploymentUpdateSchema = createUpdateSchema(deployments)
