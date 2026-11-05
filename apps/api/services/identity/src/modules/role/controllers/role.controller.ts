import { Controller } from '@nestjs/common'
import { Implement } from '@orpc/nest'

import {
    roleCreateContract,
    roleDeleteContract,
    roleListContract,
    roleUpdateContract,
} from '@deployer/identity-contracts'
import { procedure } from '@deployer/nest-effect'
import { requireAuth } from '@deployer/shared/core/modules/auth/orpc/middlewares'

import { RoleService } from '../role.service'

/** The role catalogue's read surface; `role:read` is enforced in the service. */
@Controller()
export class RoleController {
    @Implement(roleListContract)
    list() {
        return procedure(roleListContract)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const roles = yield* RoleService
                const data = yield* roles.list(input.query?.scope)
                return { data }
            })
    }

    @Implement(roleCreateContract)
    create() {
        return procedure(roleCreateContract)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const roles = yield* RoleService
                return yield* roles.create(input)
            })
    }

    @Implement(roleUpdateContract)
    update() {
        return procedure(roleUpdateContract)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const roles = yield* RoleService
                return yield* roles.update(input.params.id, input.body ?? {})
            })
    }

    @Implement(roleDeleteContract)
    remove() {
        return procedure(roleDeleteContract)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const roles = yield* RoleService
                yield* roles.remove(input.params.id)
                return { deleted: true as const }
            })
    }
}
