import z from 'zod/v4'

import { accessDescriptorOf, type AccessDescriptor } from './descriptor'

/** The shape of an implemented oRPC procedure that the audit reads: a handler and its ordered middlewares. */
const procedureSchema = z.object({
    '~orpc': z.object({
        handler: z.custom<unknown>((value) => typeof value === 'function'),
        orderedMiddlewares: z.array(z.object({ middleware: z.unknown() })).default([]),
    }),
})

/** The middlewares of an implemented oRPC procedure, in order. `undefined` when the value is not a procedure. */
function middlewaresOf(procedure: unknown): readonly unknown[] | undefined {
    const parsed = procedureSchema.safeParse(procedure)
    return parsed.success
        ? parsed.data['~orpc'].orderedMiddlewares.map((entry) => entry.middleware)
        : undefined
}

/** What a procedure declared about its access: the descriptor of its access middleware, or `undefined` when none. */
export function accessOfProcedure(
    procedure: unknown
): AccessDescriptor | undefined {
    for (const middleware of middlewaresOf(procedure) ?? []) {
        const descriptor = accessDescriptorOf(middleware)
        if (descriptor !== undefined) return descriptor
    }
    return undefined
}

export type AccessAudit = {
    /** Procedures that declared access, by path. */
    readonly declared: readonly string[]
    /** Procedures with no access middleware: the ones the boot refuses once the ledger is empty. */
    readonly undeclared: readonly string[]
    /** `accessPublic`, with the reason: the generated public surface, reviewed in pull requests. */
    readonly publicSurface: readonly { readonly path: string; readonly reason: string }[]
    /** `accessDeferred` procedures: the boundary must see a decision from each. */
    readonly deferred: readonly string[]
}

/**
 * Walk a router (nested plain objects of implemented procedures) and say which procedures declared their access.
 *
 * It reads the middleware chain, never calls anything, so it is safe at boot and in a spec. It also catches a
 * controller that bypassed `procedure()`: such a procedure has no access middleware either way.
 */
export function auditRouter(router: unknown, prefix = ''): AccessAudit {
    const declared: string[] = []
    const undeclared: string[] = []
    const publicSurface: { path: string; reason: string }[] = []
    const deferred: string[] = []

    const visit = (node: unknown, path: string): void => {
        if (middlewaresOf(node) !== undefined) {
            const descriptor = accessOfProcedure(node)
            if (descriptor === undefined) {
                undeclared.push(path)
                return
            }
            declared.push(path)
            if (descriptor.kind === 'public')
                publicSurface.push({ path, reason: descriptor.reason })
            if (descriptor.kind === 'deferred') deferred.push(path)
            return
        }
        if (node !== null && typeof node === 'object') {
            for (const [key, child] of Object.entries(node)) {
                visit(child, path === '' ? key : `${path}.${key}`)
            }
        }
    }
    visit(router, prefix)
    return { declared, undeclared, publicSurface, deferred }
}

/**
 * The boot rule. `ledger` is the set of procedure paths still allowed to be undeclared while the migration runs
 * (`AUTHZ-012`); it only shrinks. Anything undeclared and not in the ledger is a violation, and so is a ledger entry
 * that no longer needs to be there (a stale entry hides the next regression).
 */
export function assertAccessDeclared(
    audit: AccessAudit,
    ledger: readonly string[] = []
): { readonly violations: readonly string[]; readonly stale: readonly string[] } {
    const allowed = new Set(ledger)
    const violations = audit.undeclared.filter((path) => !allowed.has(path))
    const declared = new Set(audit.declared)
    const stale = ledger.filter((path) => declared.has(path))
    return { violations, stale }
}

/**
 * Audit what a controller class would mount. Its methods return implemented procedures (`@Implement(...)` binds them),
 * so calling each prototype method yields the same objects the host mounts; the router is built from their names.
 *
 * Only methods that return a procedure count. A controller that cannot be constructed without arguments should be
 * audited through its module instead.
 */
export function auditController(instance: object, prefix = ''): AccessAudit {
    const router: Record<string, unknown> = {}
    let proto = Reflect.getPrototypeOf(instance)
    while (proto !== null && proto !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(proto)) {
            if (name === 'constructor' || name in router) continue
            const member: unknown = Reflect.get(instance, name)
            if (typeof member !== 'function') continue
            const result: unknown = Reflect.apply(member, instance, [])
            if (middlewaresOf(result) !== undefined) router[name] = result
        }
        proto = Reflect.getPrototypeOf(proto)
    }
    return auditRouter(router, prefix)
}
