import { deploymentTemplateSchema } from '@deployer/contracts-entities'
import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

const templateOps = standard.zod(deploymentTemplateSchema, 'deploymentTemplate')

export const templateFindByIdContract = templateOps
    .read()
    .errors((e) => [
        // 404 for unknown template id.
        ...standardDomainErrorContracts(e),
    ])
    .build()
