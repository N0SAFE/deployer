import { UseInterceptors } from '@nestjs/common'
import { oc } from '@orpc/contract'
import { ImplementInterceptor } from '@orpc/nest'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import z from 'zod/v4'

import {
    accessPublic,
    accessRequired,
    defineResource,
    procedure,
    type AuthenticatedContext,
} from '@deployer/nest-effect'

import { auditModules, enforceAccessAudit } from './access-audit'

const contract = oc.input(z.object({}))
const User = defineResource('user', { scope: 'platform' })

class Controller {
    guarded() {
        return procedure<typeof contract, AuthenticatedContext>(contract)
            .use(accessRequired(User.can('list')))
            .effect(function* () {
                yield* Effect.void
                return 1
            })
    }
    health() {
        return procedure<typeof contract, object>(contract)
            .use(accessPublic('liveness probe'))
            .effect(function* () {
                yield* Effect.void
                return 1
            })
    }
    sneaky() {
        return procedure<typeof contract, AuthenticatedContext>(contract).effect(function* () {
            yield* Effect.void
            return 1
        })
    }
    /** A plain HTTP route: no `@Implement`, so the audit must never call it. */
    plainRoute(): never {
        throw new Error('an HTTP route was invoked by the audit')
    }
}
for (const name of ['guarded', 'health', 'sneaky']) {
    UseInterceptors(ImplementInterceptor)(
        Controller.prototype,
        name,
        Object.getOwnPropertyDescriptor(Controller.prototype, name) ?? {}
    )
}

const modules = [
    { controllers: new Map([[Controller, { instance: new Controller(), metatype: Controller }]]) },
]

describe('auditModules', () => {
    it('reads the mounted procedures through @Implement and never calls a plain route', () => {
        const { audit, unauditable } = auditModules(modules)
        expect(audit.declared).toEqual(['Controller.guarded', 'Controller.health'])
        expect(audit.undeclared).toEqual(['Controller.sneaky'])
        expect(audit.publicSurface).toEqual([
            { path: 'Controller.health', reason: 'liveness probe' },
        ])
        expect(unauditable).toEqual([])
    })

    it('skips a controller that has no instance yet', () => {
        expect(
            auditModules([{ controllers: new Map([['x', { instance: undefined }]]) }]).audit.declared
        ).toEqual([])
    })
})

describe('enforceAccessAudit', () => {
    it('reports by default and never throws', () => {
        expect(() => {
            enforceAccessAudit(modules, { mode: 'report' })
        }).not.toThrow()
    })

    it('strict refuses an undeclared procedure that is not in the ledger', () => {
        expect(() => {
            enforceAccessAudit(modules, { mode: 'strict' })
        }).toThrow('Controller.sneaky')
    })

    it('strict accepts it when it is ledgered, and refuses a stale ledger entry', () => {
        expect(() => {
            enforceAccessAudit(modules, { mode: 'strict', ledger: ['Controller.sneaky'] })
        }).not.toThrow()
        expect(() => {
            enforceAccessAudit(modules, {
                mode: 'strict',
                ledger: ['Controller.sneaky', 'Controller.guarded'],
            })
        }).toThrow('remove them')
    })

    it('is off when asked, and reports when no mode is given', () => {
        expect(() => {
            enforceAccessAudit(modules, { mode: 'off' })
        }).not.toThrow()
        expect(() => {
            enforceAccessAudit(modules)
        }).not.toThrow()
    })
})
