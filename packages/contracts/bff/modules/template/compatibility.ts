import z from 'zod/v4'

import {
    templateCompatibilityMatrixSchema,
    templateCompatibilityValidationInputSchema,
    templateCompatibilityValidationResultSchema,
} from '@deployer/contracts-entities'
import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

const templateCompatibilityMatrixOps = standard.zod(
    templateCompatibilityMatrixSchema,
    'templateCompatibilityMatrix'
)
const templateCompatibilityValidationOps = standard.zod(
    templateCompatibilityValidationResultSchema,
    'templateCompatibilityValidation'
)

export const templateGetCompatibilityMatrixContract =
    templateCompatibilityMatrixOps
        .list()
        .path('/compatibility/matrix')
        .input(z.object({}))
        .output(templateCompatibilityMatrixSchema)
        .errors((e) => [...standardDomainErrorContracts(e)])
        .build()

export const templateValidateCompatibilityContract =
    templateCompatibilityValidationOps
        .create()
        .path('/compatibility/validate')
        .input((b) => b.body(templateCompatibilityValidationInputSchema))
        .output(templateCompatibilityValidationResultSchema)
        .errors((e) => [...standardDomainErrorContracts(e)])
        .build()
