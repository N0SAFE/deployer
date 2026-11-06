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

    /** Makes a new generation current. Nothing is cut off: the earlier generation stays accepted until it is retired. */
    @Implement(secretContract.rotate)
    rotate() {
        return procedure(secretContract.rotate)
            .use(requireAuth())
            .use(accessRequired(PlatformSecretResource.can('rotate')))
            .effect(function* () {
                const secrets = yield* SecretInventory
                return yield* secrets.rotate()
            })
    }

    /** Stops accepting an earlier generation. The one step of a rotation that can make stored values unreadable. */
    @Implement(secretContract.retire)
    retire() {
        return procedure(secretContract.retire)
            .use(requireAuth())
            .use(accessRequired(PlatformSecretResource.can('retire')))
            .effect(function* ({ input }) {
                const secrets = yield* SecretInventory
                return yield* secrets.retire(input.generation)
            })
    }
}
