import { describe, expect, it } from 'vitest'

import { accessOf } from '@deployer/auth/authz/meta'
import { identityContract } from '@deployer/identity-contracts'
import { auditController } from '@deployer/nest-effect'

import { UserController } from './modules/user/controllers/user.controller'

/**
 * Every procedure this service exposes declares what it requires (`SEC-062`, `SEC-064`).
 *
 * The gate treats an undeclared procedure as a BUG in the procedure, not a decision about the caller — but in `shadow` it
 * only logs it, so a route added without a declaration still serves every signed-in caller and nobody notices. This walks
 * the contract the service actually mounts, so a new procedure fails the suite until someone says what it needs.
 *
 * The exceptions are named one by one, with the reason. A growing list is the signal that the annotation pass is behind.
 */

/** Procedures that are deliberately undeclared, with why. */
const UNDECLARED = new Map<string, string>([
    [
        'approval.require',
        'internal mesh route (`requireMesh()`): a peer names the account it authenticated and the real check runs inside, in the approval ledger',
    ],
    [
        'analytics.generateReport',
        'reports have no permission yet: generating and deleting one is not a read, and `analytics:read` would be a lie',
    ],
    ['analytics.getReport', 'reports: see analytics.generateReport'],
    ['analytics.listReports', 'reports: see analytics.generateReport'],
    ['analytics.deleteReport', 'reports: see analytics.generateReport'],
    ['analytics.downloadReport', 'reports: see analytics.generateReport'],
    ['analytics.getReportContent', 'reports: see analytics.generateReport'],
    ['analytics.createReportConfig', 'reports: see analytics.generateReport'],
    ['analytics.listReportConfigs', 'reports: see analytics.generateReport'],
    ['analytics.updateReportConfig', 'reports: see analytics.generateReport'],
    ['analytics.deleteReportConfig', 'reports: see analytics.generateReport'],
])

/**
 * Controllers that declare access themselves (`accessRequired`, `accessSelf`, `accessPublic`), so their contracts carry no
 * declaration. The audit calls each controller method and reads the middleware chain the host would mount. This list only
 * grows until it covers every controller (`AUTHZ-012`); then this whole file is replaced by the boot audit.
 */
const converted = auditController(new UserController(), 'user')

/** A mounted route: a procedure contract, not a router. */
function isProcedure(
    node: unknown
): node is { '~orpc': { meta?: Record<PropertyKey, unknown> } } {
    if (node === null || typeof node !== 'object') return false
    const orpc = (node as { readonly '~orpc'?: Record<string, unknown> })[
        '~orpc'
    ]
    return orpc !== undefined && 'inputSchemas' in orpc
}

function procedures(node: unknown, path: string[] = []): string[] {
    if (isProcedure(node)) return [path.join('.')]
    if (node === null || typeof node !== 'object') return []
    return Object.entries(node).flatMap(([key, value]) =>
        procedures(value, [...path, key])
    )
}

/** Reads the declaration off the same object the gate sees. */
function declared(node: unknown, path: string[]): unknown {
    let current = node
    for (const key of path) current = (current as Record<string, unknown>)[key]
    return accessOf(current)
}

describe('identity authz declarations', () => {
    const paths = procedures(identityContract)

    it('finds the procedures it is meant to check', () => {
        // A guard that silently scans nothing is worse than no guard.
        expect(paths.length).toBeGreaterThan(30)
    })

    it('declares access on every procedure, except the named exceptions', () => {
        const undeclared = paths
            .filter((path) => !UNDECLARED.has(path))
            .filter((path) => !converted.declared.includes(path))
            .filter(
                (path) =>
                    declared(identityContract, path.split('.')) === undefined
            )

        expect(undeclared).toEqual([])
    })

    it('has every user procedure declared in its controller, with the public surface named', () => {
        expect(converted.undeclared).toEqual([])
        expect(converted.declared.length).toBeGreaterThanOrEqual(14)
        expect(converted.publicSurface.map((entry) => entry.path)).toEqual([
            'user.checkEmail',
        ])
        // every converted path is a real contract procedure: a rename must not strand a declaration
        expect(
            converted.declared.filter((path) => !paths.includes(path))
        ).toEqual([])
    })

    it('keeps the exception list honest: each entry really is undeclared', () => {
        const stale = [...UNDECLARED.keys()]
            .filter((path) => paths.includes(path))
            .filter(
                (path) =>
                    declared(identityContract, path.split('.')) !== undefined
            )

        expect(stale).toEqual([])
    })

    it('names a permission or `self` on the mutations, never a bare allow', () => {
        // A declaration that carries neither a permission, `self`, nor `public` would make the gate's own `decide` call
        // read an undefined permission — the one shape the type cannot rule out once it travels as metadata.
        const shapeless = paths
            .map(
                (path) =>
                    [path, declared(identityContract, path.split('.'))] as const
            )
            .filter(([, declaration]) => declaration !== undefined)
            .filter(([, declaration]) => {
                const value = declaration as {
                    permission?: unknown
                    self?: unknown
                    public?: unknown
                }
                return (
                    value.permission === undefined &&
                    value.self !== true &&
                    value.public !== true
                )
            })
            .map(([path]) => path)

        expect(shapeless).toEqual([])
    })
})
