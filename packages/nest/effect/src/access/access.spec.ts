import '@orpc/effect/extensions/effect'

import { oc } from '@orpc/contract'
import { call } from '@orpc/server'
import { Context, Effect } from 'effect'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import z from 'zod/v4'

import type { Actor, CapabilitySet, Permission } from '@deployer/auth/authz'

import { configureAuthz, type DecisionEvent, type PermissionStore } from '../authz'
import { procedure, type RequiredBy } from '../requirements'

import {
    accessDeferred,
    accessDescriptorOf,
    accessOfProcedure,
    accessPublic,
    accessRequired,
    accessSelf,
    assertAccessDeclared,
    auditController,
    auditRouter,
    defineResource,
    ScopeNotFound,
    ServiceScope,
    type AuthenticatedContext,
    type ScopeResolverShape,
} from './index'

/**
 * The access middleware is proved through the real builder, on a real contract: what the controller writes is what the
 * caller experiences, and the types are asserted next to the behaviour they guard.
 */
const Service = defineResource('service', { scope: 'service', idKey: 'serviceId' })
const User = defineResource('user', { scope: 'platform', idKey: 'userId' })

const deploy = oc.input(z.object({ serviceId: z.string(), force: z.boolean().optional() }))
const list = oc.input(z.object({}))
const update = oc.input(z.object({ userId: z.string() }))
const nested = oc.input(z.object({ params: z.object({ id: z.string() }), body: z.object({ role: z.string() }) }))

type Ctx = AuthenticatedContext & {
    readonly 'effect/context'?: Context.Context<never>
}

const caller = (id: string, effectContext?: Context.Context<never>): Ctx => ({
    auth: { isLoggedIn: true, user: { id } },
    ...(effectContext === undefined ? {} : { 'effect/context': effectContext }),
})

/** A store that grants by (kind, id): the stand-in for grants until the database-backed store lands. */
const storeOf = (
    grants: Readonly<Record<string, readonly Permission[]>>
): PermissionStore => ({
    capabilities: (_actor: Actor, scope): Promise<CapabilitySet> =>
        Promise.resolve({
            permissions: grants[`${scope.kind}:${scope.id ?? ''}`] ?? [],
            sources: [`grant ${scope.kind}:${scope.id ?? ''}`],
        }),
})

/** `service -> project` for a known id, `ScopeNotFound` otherwise. */
const serviceScope: ScopeResolverShape = {
    kind: 'service',
    lineage: (id) =>
        id === 'ghost'
            ? Effect.fail(new ScopeNotFound('service', id))
            : Effect.succeed([
                  { kind: 'service', id },
                  { kind: 'project', id: 'p1' },
              ]),
    facts: () => Effect.succeed({}),
}
const withScope = Context.make(ServiceScope, serviceScope)

afterEach(() => {
    configureAuthz(null)
})

describe('accessRequired', () => {
    const deployProcedure = () =>
        procedure<typeof deploy, Ctx>(deploy)
            .use(accessRequired(Service.can('deploy')))
            .effect(function* ({ context }) {
                yield* Effect.void
                return { scope: context.access.service.scope, via: context.access.service.via }
            })
    const run = (ctx: Ctx, input = { serviceId: 'svc1' }) =>
        call(deployProcedure(), input, { context: ctx })

    it('allows a caller who holds the permission on a scope above the service', async () => {
        configureAuthz({
            store: storeOf({ 'project:p1': ['service:deploy'] }),
            mode: 'enforce',
        })
        await expect(
            run(caller('u1', withScope))
        ).resolves.toMatchObject({ via: 'permission', scope: { kind: 'service', id: 'svc1' } })
    })

    it('refuses a caller who holds it only on a sibling', async () => {
        configureAuthz({ store: storeOf({ 'project:p2': ['service:deploy'] }), mode: 'enforce' })
        await expect(
            run(caller('u1', withScope))
        ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('lets a platform grant reach every service', async () => {
        configureAuthz({ store: storeOf({ 'platform:': ['service:deploy'] }), mode: 'enforce' })
        await expect(
            run(caller('u1', withScope))
        ).resolves.toMatchObject({ via: 'permission' })
    })

    it('conceals a scope that does not exist as a 404', async () => {
        configureAuthz({ store: storeOf({ 'platform:': ['service:deploy'] }), mode: 'enforce' })
        await expect(
            run(caller('u1', withScope), { serviceId: 'ghost' })
        ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('fails loudly when the service forgot to provide the scope plugin', async () => {
        configureAuthz({ store: storeOf({}), mode: 'enforce' })
        await expect(run(caller('u1'))).rejects.toMatchObject({
            code: 'INTERNAL_SERVER_ERROR',
            message: expect.stringContaining('no service scope plugin'),
        })
    })

    it('logs but does not block in shadow mode, and records the decision', async () => {
        const events: DecisionEvent[] = []
        configureAuthz({
            store: storeOf({}),
            mode: 'shadow',
            onDecision: (e) => events.push(e),
        })
        await expect(
            run(caller('u1', withScope))
        ).resolves.toMatchObject({ via: 'permission' })
        expect(events[0]).toMatchObject({ enforced: false, decision: { allowed: false } })
    })

    it('records `off` instead of hiding it, and does no lookup', async () => {
        const capabilities = vi.fn()
        configureAuthz({ store: { capabilities }, mode: 'off' })
        await expect(run(caller('u1'))).resolves.toMatchObject({ via: 'off' })
        expect(capabilities).not.toHaveBeenCalled()
    })

    it('answers 401 when there is no actor, whatever the mode', async () => {
        configureAuthz({ store: storeOf({}), mode: 'off' })
        await expect(
            // @ts-expect-error an anonymous caller is exactly what the types forbid; the runtime must still answer 401
            call(deployProcedure(), { serviceId: 's' }, { context: {} })
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })
})

describe('platform resources and the subject', () => {
    it('checks a platform permission with no id', async () => {
        configureAuthz({ store: storeOf({ 'platform:': ['user:list'] }), mode: 'enforce' })
        const p = procedure<typeof list, Ctx>(list)
            .use(accessRequired(User.can('list')))
            .effect(function* ({ context }) {
                yield* Effect.void
                return context.access.user.scope
            })
        await expect(call(p, {}, { context: caller('u1') })).resolves.toEqual({ kind: 'platform' })
        await expect(call(p, {}, { context: caller('u1') })).resolves.toBeDefined()
    })

    it('refuses without the permission, and passes `.orSelf()` for the caller\'s own id', async () => {
        configureAuthz({ store: storeOf({}), mode: 'enforce' })
        const p = procedure<typeof update, Ctx>(update)
            .use(accessRequired(User.can('update').orSelf()))
            .effect(function* ({ context }) {
                yield* Effect.void
                return context.access.user.via
            })
        await expect(call(p, { userId: 'other' }, { context: caller('u1') })).rejects.toMatchObject({ code: 'FORBIDDEN' })
        await expect(call(p, { userId: 'u1' }, { context: caller('u1') })).resolves.toBe('self')
    })
})

describe('a nested id', () => {
    const SubjectUser = defineResource('user', { scope: 'platform', idKey: 'id' })
    const setRole = () =>
        procedure<typeof nested, Ctx>(nested)
            .use(accessRequired(SubjectUser.can('set-role').on('params.id').orSelf()))
            .effect(function* ({ context }) {
                yield* Effect.void
                return context.access.user.via
            })

    it('reads the id at the dotted path', async () => {
        configureAuthz({ store: storeOf({ 'platform:': ['user:set-role'] }), mode: 'enforce' })
        await expect(
            call(setRole(), { params: { id: 'other' }, body: { role: 'admin' } }, { context: caller('u1') })
        ).resolves.toBe('permission')
        // the caller's own id passes through `.orSelf()` without any permission
        configureAuthz({ store: storeOf({}), mode: 'enforce' })
        await expect(
            call(setRole(), { params: { id: 'u1' }, body: { role: 'admin' } }, { context: caller('u1') })
        ).resolves.toBe('self')
    })

    it('refuses a path that is not a path, and requires the nested shape in the input', () => {
        expect(() => SubjectUser.can('update').on('a..b')).toThrow('not a field path')
        // @ts-expect-error `deploy` has no `params.id`
        procedure<typeof deploy, Ctx>(deploy).use(accessRequired(SubjectUser.can('update').on('params.id')))
    })
})

describe('the other forms', () => {
    it('accessPublic needs a reason and lets an anonymous caller through', async () => {
        expect(() => accessPublic(' ')).toThrow('reason')
        const p = procedure<typeof list, object>(list)
            .use(accessPublic('health probe'))
            .effect(function* ({ context }) {
                yield* Effect.void
                return context.access.public.reason
            })
        await expect(call(p, {}, { context: {} })).resolves.toBe('health probe')
    })

    it('accessSelf and accessDeferred need an actor', async () => {
        const self = procedure<typeof list, Ctx>(list)
            .use(accessSelf('their own sessions'))
            .effect(function* () {
                yield* Effect.void
                return 'ok' as const
            })
        // @ts-expect-error an anonymous caller is what the types forbid; the runtime must still answer 401
        await expect(call(self, {}, { context: {} })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
        await expect(call(self, {}, { context: caller('u1') })).resolves.toBe('ok')
        expect(() => accessDeferred('')).toThrow('reason')
    })

    it('every access middleware carries a descriptor the boot audit can read', () => {
        expect(accessDescriptorOf(accessRequired(Service.can('read')))).toMatchObject({
            kind: 'required',
            requirements: [{ permission: 'service:read', scope: 'service', key: 'serviceId' }],
        })
        expect(accessDescriptorOf(accessSelf('x'))).toMatchObject({ kind: 'self' })
        expect(accessDescriptorOf(accessPublic('x'))).toMatchObject({ kind: 'public' })
        expect(accessDescriptorOf(accessDeferred('x'))).toMatchObject({ kind: 'deferred' })
        expect(accessDescriptorOf(() => 1)).toBeUndefined()
    })

    it('the descriptor survives `.use()` onto a procedure, and the audit reads it', () => {
        const guarded = procedure<typeof deploy, Ctx>(deploy)
            .use(accessRequired(Service.can('deploy')))
            .effect(function* () {
                yield* Effect.void
                return 1
            })
        expect(accessOfProcedure(guarded)).toMatchObject({ kind: 'required' })
    })
})

describe('boot audit', () => {
    const guarded = () =>
        procedure<typeof deploy, Ctx>(deploy)
            .use(accessRequired(Service.can('deploy')))
            .effect(function* () {
                yield* Effect.void
                return 1
            })
    const open = () =>
        procedure<typeof list, Ctx>(list).effect(function* () {
            yield* Effect.void
            return 1
        })
    const health = () =>
        procedure<typeof list, object>(list)
            .use(accessPublic('liveness probe'))
            .effect(function* () {
                yield* Effect.void
                return 1
            })
    const deferred = () =>
        procedure<typeof list, Ctx>(list)
            .use(accessDeferred('scope known after load'))
            .effect(function* () {
                yield* Effect.void
                return 1
            })

    const router = { service: { deploy: guarded(), sneaky: open() }, health: health(), transfer: deferred() }

    it('lists what declared, what did not, the public surface and the deferred ones', () => {
        expect(auditRouter(router)).toEqual({
            declared: ['service.deploy', 'health', 'transfer'],
            undeclared: ['service.sneaky'],
            publicSurface: [{ path: 'health', reason: 'liveness probe' }],
            deferred: ['transfer'],
        })
    })

    it('refuses an undeclared procedure that is not in the ledger', () => {
        expect(assertAccessDeclared(auditRouter(router), [])).toEqual({
            violations: ['service.sneaky'],
            stale: [],
        })
    })

    it('tolerates a ledgered one, and reports a stale ledger entry', () => {
        expect(
            assertAccessDeclared(auditRouter(router), ['service.sneaky', 'service.deploy'])
        ).toEqual({ violations: [], stale: ['service.deploy'] })
    })

    it('audits a controller by calling its methods, as the host mounts them', () => {
        class Ctrl {
            guarded() {
                return guarded()
            }
            sneaky() {
                return open()
            }
            helper() {
                return 'not a procedure'
            }
        }
        expect(auditController(new Ctrl())).toMatchObject({
            declared: ['guarded'],
            undeclared: ['sneaky'],
        })
    })

    it('treats a value that is not a procedure as nothing, not as a violation', () => {
        expect(auditRouter({ a: 1, b: null, c: { d: 'x' } })).toEqual({
            declared: [],
            undeclared: [],
            publicSurface: [],
            deferred: [],
        })
    })
})

describe('types', () => {
    it('adds the scope plugin a requirement reads to the procedure\'s requirements, and nothing for the platform', () => {
        const platformOnly = procedure<typeof list, Ctx>(list)
            .use(accessRequired(User.can('list')))
            .effect(function* () {
                yield* Effect.void
                return 1
            })
        const scoped = procedure<typeof deploy, Ctx>(deploy)
            .use(accessRequired(Service.can('deploy')))
            .effect(function* () {
                yield* Effect.void
                return 1
            })
        const requirementsOf = <P>(_procedure: P) => expectTypeOf<RequiredBy<P>>()
        requirementsOf(platformOnly).toBeNever()
        requirementsOf(scoped).toEqualTypeOf<ServiceScope>()
    })

    it('catalogs the actions of a resource and nothing else', () => {
        expectTypeOf<Parameters<typeof Service.can>[0]>().toEqualTypeOf<
            'read' | 'create' | 'update' | 'deploy' | 'delete'
        >()
        // `launch` is not a service action: a type error, and the runtime refuses it too
        // @ts-expect-error not in the catalog
        expect(() => Service.can('launch')).toThrow('permission catalog')
    })

    it('requires the authenticated context, so it cannot precede requireAuth()', () => {
        // @ts-expect-error an anonymous initial context does not satisfy `AuthenticatedContext`
        procedure(deploy).use(accessRequired(Service.can('deploy')))
    })

    it('requires the input to carry the field that locates the scope', () => {
        // @ts-expect-error `list` has no `serviceId`
        procedure<typeof list, Ctx>(list).use(accessRequired(Service.can('deploy')))
        // accepted: the field is named explicitly and present
        procedure<typeof update, Ctx>(update).use(accessRequired(Service.can('deploy').on('userId')))
    })

    it('types the proof by the requirement name', () => {
        procedure<typeof deploy, Ctx>(deploy)
            .use(accessRequired(Service.can('deploy').as('target')))
            .effect(function* ({ context }) {
                yield* Effect.void
                expectTypeOf(context.access.target.permission).toEqualTypeOf<'service:deploy'>()
                expectTypeOf(context.access.target.scope.kind).toEqualTypeOf<'service'>()
                expectTypeOf(context.access).not.toHaveProperty('service')
                return 1
            })
    })

    it('rejects two requirements with the same name', () => {
        procedure<typeof deploy, Ctx>(deploy).use(
            // @ts-expect-error both are named `service`
            accessRequired(Service.can('read'), Service.can('deploy'))
        )
    })
})
