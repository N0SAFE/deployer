import {
    type AuthzMode,
    type AuthzOptions,
    type DecisionEvent,
    type PermissionStore,
} from '@deployer/nest-effect/authz'

import { permissionsOfRole } from './role-catalog'

/**
 * Where the gate's capabilities come from.
 *
 * PLATFORM scope reads the process snapshot (`SEC-055`), which is the `roles` TABLE — so a custom role works, and a role
 * deleted while its holders still carry the name grants nothing.
 *
 * PROJECT scope answers NOTHING on purpose (`SEC-059`): membership lives in `project_collaborators`, owned by the project
 * service, and this process cannot see it. A project-scoped declaration under `enforce` is therefore a denial — which is
 * the fail-closed direction and the reason project-scoped routes stay with their owning service, whose handlers check
 * membership against the data they actually have. Wiring a mesh call in here would put a network round-trip (and a second
 * authority) inside every request.
 */
export function roleTableStore(): PermissionStore {
    return {
        capabilities: (actor, scope) =>
            Promise.resolve(
                scope.kind === 'platform'
                    ? {
                          permissions: permissionsOfRole(actor.role),
                          sources: [`role ${actor.role}`],
                      }
                    : { permissions: [], sources: [] }
            ),
    }
}

/** `AUTHZ_MODE=off|shadow|enforce`; anything else is `off` with one warning, so a typo cannot lock the platform out. */
// shortcut: the rollout mode is still read from `AUTHZ_MODE`; upgrade when `AccessPolicy` is sourced from runtime config (SEC-104, SEC-105).
export function authzFromEnv(): AuthzOptions | null {
    const raw = process.env.AUTHZ_MODE?.trim().toLowerCase()
    if (raw === undefined || raw === '' || raw === 'off') return null
    if (raw !== 'shadow' && raw !== 'enforce') {
        console.warn(
            `[authz] AUTHZ_MODE="${raw}" is not off|shadow|enforce; authorization stays off`
        )
        return null
    }
    const mode: AuthzMode = raw
    return {
        store: roleTableStore(),
        mode,
        // Shadow mode is only useful if the would-denies are visible: one line per refusal, no payload.
        onDecision: (event: DecisionEvent) => {
            if (event.decision.allowed) return
            console.debug(
                `[authz] would deny ${event.decision.permission} on ${event.decision.scope.kind}` +
                    (event.decision.scope.id === undefined
                        ? ''
                        : `:${event.decision.scope.id}`) +
                    ` for ${event.actor?.id ?? 'anonymous'} (${event.decision.reason})${event.mode === 'enforce' ? '' : ' [shadow]'}`
            )
        },
    }
}


/**
 * The policy the access checks depend on (`AccessPolicy`): always one, because a missing policy is not "unprotected", it is a
 * module that does not compile. `off` is what an app that has not opted in gets.
 */
export function accessPolicy(): AuthzOptions {
    return authzFromEnv() ?? { store: roleTableStore(), mode: 'off' }
}
