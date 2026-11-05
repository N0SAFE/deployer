import z from 'zod/v4'

import {
    addServiceDomainResponseSchema,
    addServiceDomainSchema,
} from '../schemas'

import { serviceDomainOps } from './shared'

export const addServiceDomainContract = serviceDomainOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/${p('serviceId', z.uuid())}/domains`)
            .body(
                z.object({
                    projectDomainId:
                        addServiceDomainSchema.shape.projectDomainId,
                    subdomain: addServiceDomainSchema.shape.subdomain,
                    basePath: addServiceDomainSchema.shape.basePath,
                    isPrimary: addServiceDomainSchema.shape.isPrimary,
                    sslEnabled: addServiceDomainSchema.shape.sslEnabled,
                    sslProvider: addServiceDomainSchema.shape.sslProvider,
                })
            )
    )
    .output(addServiceDomainResponseSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(
        access({
            permission: 'domain:write',
            scope: { by: 'input', path: 'params.serviceId', kind: 'service' },
        })
    )
    .build()

import { access } from '@deployer/auth/authz/meta'
import { standardDomainErrorContracts } from '@deployer/orpc-utils'
