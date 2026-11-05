import { Cause, Context, Effect } from 'effect'

import type { SetupPostSetupDestination } from '@deployer/contracts-entities'
import { serviceOver, type Over } from '@deployer/effect-core'

import type { HostnameService } from '@/core/modules/platform-ingress/services/hostname.service'
import type { PlatformConfigServiceShape } from '@/core/modules/platform-ingress/services/platform-config.service'

import { SetupHostnamePort, SetupPlatformConfigPort } from '../setup.ports'

type Ports = {
    readonly hostnameService: HostnameService
    readonly platformConfig: PlatformConfigServiceShape
}

/** What the destination reads from the Effect context while it runs. */
export type PostSetupDestinationPorts =
    SetupHostnamePort | SetupPlatformConfigPort

export type PostSetupDestinationServiceShape = {
    /** Where the final click lands. Never fails: an unreadable flag means "no dashboard". */
    readonly resolve: () => Effect.Effect<SetupPostSetupDestination>
}

/** The API's own management page for the web app. */
const CONSOLE_PATH = '/manage/web-app'

/**
 * Decides where the wizard's final "continue to dashboard" click lands.
 *
 * ── WHY THE SERVER OWNS THIS ─────────────────────────────────────────────────
 * The client used to derive the destination from `window.location`, which is
 * only ever a guess about deployment shape. That guess was wrong in exactly the
 * case that matters: when the operator chose "API only" during onboarding there
 * is no dashboard, but the wizard would still send them to `web.<host>` — a
 * hostname with no router, so a 404 on the last click of a successful setup.
 *
 * The answer depends on state the client cannot see: whether the managed web app
 * is enabled (a DB flag the API owns), and which hostname that implies. So the
 * API answers, and the client follows.
 *
 * ── THE TWO DESTINATIONS ─────────────────────────────────────────────────────
 *   dashboard    the platform's own web app — used when the flag is on. It is
 *                the product surface, so it wins whenever it exists.
 *   api-console  the API's `/manage/web-app` page, which the API serves ITSELF
 *                and which offers to enable a dashboard. Chosen when no web app
 *                is running, because it cannot 404 the way `web.<host>` would:
 *                the CLI went to real trouble to make the fallback honest, and
 *                pointing at a non-existent host would undo that.
 *
 * A failure to READ the flag is treated as "no dashboard" rather than thrown:
 * the operator has just completed setup and needs somewhere to go, and the
 * console page is always answerable.
 */
export class PostSetupDestinationService extends Context.Service<
    PostSetupDestinationService,
    Over<PostSetupDestinationServiceShape, PostSetupDestinationPorts>
>()('bff/PostSetupDestinationService') {
    static readonly live = serviceOver(
        Effect.all({
            hostnameService: SetupHostnamePort,
            platformConfig: SetupPlatformConfigPort,
        }),
        makePostSetupDestinationService
    )
}

export function makePostSetupDestinationService({
    hostnameService,
    platformConfig,
}: Ports): PostSetupDestinationServiceShape {
    // The flag lives in the global DB, which is provisioned DURING setup. A read can legitimately fail if this is called
    // before that finished — the console page is the safe answer, and it is the page that lets the operator turn a
    // dashboard on.
    const readManagedWebEnabled = platformConfig
        .isManagedWebAppEnabled()
        .pipe(
            Effect.catchCause((cause) =>
                Effect.logWarning(
                    `Could not read the managed-web flag (${Cause.pretty(cause)}) — directing to the API console`
                ).pipe(Effect.as(false))
            )
        )

    const readManagedWebOrigin = platformConfig.getManagedWebOrigin().pipe(
        Effect.map((origin) => {
            if (origin === null || origin.trim().length === 0) return null
            // `getManagedWebOrigin` stores a bare host (scheme stripped when set), so
            // it must be given one back before it can be navigated to.
            return /^https?:\/\//i.test(origin) ? origin : `http://${origin}`
        }),
        Effect.catchCause(() => Effect.succeed(null))
    )

    return {
        resolve: () =>
            Effect.gen(function* () {
                if (yield* readManagedWebEnabled) {
                    // An explicit operator origin (custom domain / tunnel) wins over the
                    // derived hostname — the same precedence the ingress uses to publish the
                    // web router, so the URL and the route cannot disagree.
                    const origin = yield* readManagedWebOrigin
                    return {
                        kind: 'dashboard' as const,
                        url: origin ?? hostnameService.webOrigin(),
                        managedWebEnabled: true,
                    }
                }
                return {
                    kind: 'api-console' as const,
                    // Served by this API, on the API's own public origin.
                    url: `${hostnameService.apiOrigin()}${CONSOLE_PATH}`,
                    managedWebEnabled: false,
                }
            }),
    }
}
