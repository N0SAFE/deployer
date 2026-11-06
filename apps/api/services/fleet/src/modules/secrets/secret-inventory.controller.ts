import { Controller } from '@nestjs/common'
import { Implement } from '@orpc/nest'

import { secretContract } from '@deployer/fleet-contracts'
import { accessRequired, procedure } from '@deployer/nest-effect'
import { requireAuth } from '@deployer/shared/core/modules/auth/orpc/middlewares'

import { PlatformSecretResource } from './access/secret.resource'
import { SecretInventory } from './secret-inventory.service'

/** The secrets of the fleet, by fingerprint. The permission is `platform.secret:read`: it never returns a value. */
@Controller()
export class SecretInventoryController {
    @Implement(secretContract.inventory)
    inventory() {
        return procedure(secretContract.inventory)
            .use(requireAuth())
            .use(accessRequired(PlatformSecretResource.can('read')))
            .effect(function* () {
                const secrets = yield* SecretInventory
                return yield* secrets.inventory()
            })
    }
}
