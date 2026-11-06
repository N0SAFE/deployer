import { Controller } from '@nestjs/common'
import { Implement } from '@orpc/nest'

import { secretContract } from '@deployer/fleet-contracts'
import { accessRequired, procedure } from '@deployer/nest-effect'
import { requireAuth } from '@deployer/shared/core/modules/auth/orpc/middlewares'

import { PlatformSecretResource } from './access/secret.resource'
import { SecretInventory } from './secret-inventory.service'
import { StepUpGateway } from './step-up.gateway'

/**
 * The secrets of the fleet, by fingerprint. Reading needs `platform.secret:read` and never returns a value; rotating and retiring
 * need their own permission AND a passkey step-up, because they change what the whole fleet accepts.
 */
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

    /** How many stored values sit under each key generation: the figure to read before retiring one. Counts only. */
    @Implement(secretContract.stored)
    stored() {
        return procedure(secretContract.stored)
            .use(requireAuth())
            .use(accessRequired(PlatformSecretResource.can('read')))
            .effect(function* () {
                const secrets = yield* SecretInventory
                return yield* secrets.stored()
            })
    }

    /** Makes a new generation current. Nothing is cut off: the earlier generation stays accepted until it is retired. */
    @Implement(secretContract.rotate)
    rotate() {
        return procedure(secretContract.rotate)
            .use(requireAuth())
            .use(accessRequired(PlatformSecretResource.can('rotate')))
            .effect(function* () {
                // A passkey proof first: rotating changes what the whole fleet accepts.
                yield* (yield* StepUpGateway).assertCritical()
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
                yield* (yield* StepUpGateway).assertCritical()
                const secrets = yield* SecretInventory
                return yield* secrets.retire(input.generation)
            })
    }
}
