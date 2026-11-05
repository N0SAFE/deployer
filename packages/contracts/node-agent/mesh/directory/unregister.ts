import z from 'zod/v4'

import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

export const meshUnregisterInput = z.object({ replicaId: z.string().min(1) })
export const meshUnregisterOutput = z.object({ removed: z.boolean() })

const meshUnregisterOps = standard.zod(meshUnregisterOutput, 'meshUnregister')

export const meshUnregisterContract = meshUnregisterOps
    .create()
    .path('/unregister')
    .input((b) => b.body(meshUnregisterInput))
    .output(meshUnregisterOutput)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build()
