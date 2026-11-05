import z from 'zod/v4'

import {
    collaboratorSchema,
    inviteCollaboratorSchema,
} from '@deployer/contracts-entities'
import { standard } from '@deployer/orpc-utils'

export const projectIdParamSchema = z.object({ id: z.uuid() })

export const projectCollaboratorParamsSchema = z.object({
    id: z.uuid(),
    userId: z.string(),
})

export const projectCollaboratorOps = standard.zod(
    collaboratorSchema,
    'projectCollaborator'
)
export const projectCollaboratorInviteOps = standard.zod(
    inviteCollaboratorSchema,
    'projectCollaboratorInvite'
)
