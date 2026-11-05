import z from 'zod/v4'

import { access } from '@deployer/auth/authz/meta'
import { projectSecurityConfigSchema } from '@deployer/contracts-entities'
import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

/**
 * What a security-config READ answers.
 *
 * ── WHY THE SECRETS ARE DROPPED, NOT JUST OPTIONAL ──────────────────────────
 * The stored shape carries `webhookSecret` and `basicAuthPassword` because the
 * write path needs them. Echoing them back made every `read` access level a
 * secret-disclosure level: a `viewer` could read the HMAC key of the inbound
 * webhook and the basic-auth password of the preview URLs. The response now
 * says WHETHER each is set (`has*`) and never WHAT it is. The write shape is
 * unchanged — a new secret is still accepted — so a client sends a secret and
 * gets only confirmation back.
 */
export const projectSecurityConfigReadSchema =
    projectSecurityConfigSchema.extend({
        webhookSecret: z.string().nullish(),
        basicAuthPassword: z.string().nullish(),
        hasWebhookSecret: z.boolean(),
        hasBasicAuthPassword: z.boolean(),
    })

const projectSecurityConfigOps = standard.zod(
    projectSecurityConfigSchema,
    'projectSecurityConfig'
)

export const projectGetSecurityConfigContract = projectSecurityConfigOps
    .read({ idFieldName: 'id', idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p('id', z.uuid())}/config/security`))
    .output(projectSecurityConfigReadSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(
        access({
            permission: 'project:read',
            scope: { by: 'input', path: 'params.id', kind: 'project' },
        })
    )
    .build()
