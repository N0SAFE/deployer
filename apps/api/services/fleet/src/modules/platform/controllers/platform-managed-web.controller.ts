/**
 * PlatformManagedWebController — ORPC ops powering the BEAUTIFUL managed web
 * console inside the web app (the visual Traefik routes `/manage/web-app` to
 * when the web app is enabled).
 *
 * Public (like the HTML console it parallels): the single console URL must
 * keep working logged-out — the parallel API HTML console is anonymous, and
 * the state query doubles as the "is the web app down?" fallback status.
 * All logic delegates to PlatformManagedWebService, resolved from the module's
 * Effect context and run through the `.effect()` boundary (which provides an anonymous actor
 * for these public calls).
 */

import { Controller } from '@nestjs/common'
import { Implement } from '@orpc/nest'

import { platformContract } from '@deployer/fleet-contracts'
import { procedure } from '@deployer/nest-effect'

import { PlatformManagedWebService } from '../services/platform-managed-web.service'

@Controller()
export class PlatformManagedWebController {
    @Implement(platformContract.getManagedWebState)
    state() {
        return procedure(platformContract.getManagedWebState).effect(
            function* () {
                const managedWeb = yield* PlatformManagedWebService
                return yield* managedWeb.state()
            }
        )
    }

    @Implement(platformContract.toggleManagedWeb)
    toggle() {
        return procedure(platformContract.toggleManagedWeb).effect(
            function* () {
                const managedWeb = yield* PlatformManagedWebService
                const state = yield* managedWeb.toggle()
                return { status: 201 as const, body: { state } }
            }
        )
    }

    @Implement(platformContract.restartManagedWeb)
    restart() {
        return procedure(platformContract.restartManagedWeb).effect(
            function* () {
                const managedWeb = yield* PlatformManagedWebService
                const state = yield* managedWeb.restart()
                return { status: 201 as const, body: { state } }
            }
        )
    }

    @Implement(platformContract.setManagedWebOrigin)
    setOrigin() {
        return procedure(platformContract.setManagedWebOrigin).effect(
            function* ({ input }) {
                const managedWeb = yield* PlatformManagedWebService
                const state = yield* managedWeb.setOrigin(input.origin)
                return { status: 201 as const, body: { state } }
            }
        )
    }

    @Implement(platformContract.enableManagedWebTunnel)
    enableTunnel() {
        return procedure(platformContract.enableManagedWebTunnel).effect(
            function* ({ input }) {
                const managedWeb = yield* PlatformManagedWebService
                const state = yield* managedWeb.enableTunnel(input.hostname)
                return { status: 201 as const, body: { state } }
            }
        )
    }

    @Implement(platformContract.disableManagedWebTunnel)
    disableTunnel() {
        return procedure(platformContract.disableManagedWebTunnel).effect(
            function* () {
                const managedWeb = yield* PlatformManagedWebService
                const state = yield* managedWeb.disableTunnel()
                return { status: 201 as const, body: { state } }
            }
        )
    }
}
