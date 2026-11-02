import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { ForbiddenError, type ResourceRule } from '@deployer/auth'

import { PermissionRepositoryFailure } from '../permission.failures'
import { PermissionRepository } from '../repositories/permission.repository'

import {
    PermissionService,
    type PermissionServiceShape,
} from './permission.service'

import type { PermissionRepositoryShape } from '../repositories/permission.repository'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ctx = { userId: 'user-1', platformRole: 'developer' as const }
const record = { ownerId: 'user-1' }

const readAllRule: ResourceRule = {
    resource: 'project',
    actions: ['read'],
    scope: { type: 'all' },
}

const row = {
    id: 'rule-1',
    roleName: 'developer',
    resourceRules: [readAllRule],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
}

type RepoBound = {
    [K in keyof PermissionServiceShape]: PermissionServiceShape[K] extends (
        ...args: infer P
    ) => Effect.Effect<infer A, infer E, any>
        ? (...args: P) => Effect.Effect<A, E, PermissionRepository>
        : never
}

/** The service, built over whichever repository the run provides. */
const service = new Proxy({} as RepoBound, {
    get:
        (_target, key: keyof PermissionServiceShape) =>
        (...args: unknown[]) =>
            (PermissionService.live[key] as (...a: unknown[]) => Effect.Effect<unknown, unknown, PermissionRepository>)(...args),
})

/** Fake repository whose methods are plain Effects — no DB needed. */
function fakeRepository(rules: ResourceRule[] = [readAllRule]) {
    return {
        getRoleRules: vi.fn((roleNames: string[]) =>
            Effect.succeed(roleNames.length === 0 ? [] : rules)
        ),
        upsertRoleRules: vi.fn(() => Effect.succeed(undefined)),
        deleteRoleRules: vi.fn(() => Effect.succeed(undefined)),
        listRoleRules: vi.fn(() => Effect.succeed([row])),
    } satisfies PermissionRepositoryShape
}

/** Run a service Effect with the fake repository and an unused database. */
function run<A, E>(
    effect: Effect.Effect<A, E, PermissionRepository>,
    repo: PermissionRepositoryShape
): Promise<A> {
    return Effect.runPromise(
        effect.pipe(Effect.provideService(PermissionRepository, repo))
    )
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('PermissionService (Effect)', () => {
    describe('check', () => {
        it('allows when the role has a matching rule', async () => {
            const repo = fakeRepository()

            const out = await run(service.check(ctx, 'project', 'read'), repo)

            expect(out.decision).toBe('ALLOW')
            expect(repo.getRoleRules).toHaveBeenCalledWith(['developer'])
        })

        it('denies when no rule matches the action', async () => {
            const out = await run(
                service.check(ctx, 'project', 'delete'),
                fakeRepository()
            )

            expect(out.decision).toBe('DENY')
        })

        it('denies when the repository has no rules', async () => {
            const out = await run(
                service.check(ctx, 'project', 'read'),
                fakeRepository([])
            )

            expect(out.decision).toBe('DENY')
        })

        it('fails loudly when the rules cannot be loaded, instead of denying as if none were configured', async () => {
            // The loader used to `.catch(() => [])`: a database outage became "No rules configured", i.e. an
            // infrastructure failure dressed as a permission policy. It must surface as a dependency failure.
            const failure = new PermissionRepositoryFailure({ cause: new Error('connection refused') })
            const repo = {
                ...fakeRepository(),
                getRoleRules: vi.fn(() => Effect.fail(failure)),
            } satisfies PermissionRepositoryShape

            await expect(run(service.check(ctx, 'project', 'read'), repo)).rejects.toMatchObject({
                _tag: 'PermissionRepositoryFailure',
            })
        })

        it('forwards the resource id and record to the engine', async () => {
            const out = await run(
                service.check(ctx, 'project', 'read', 'proj-1', record),
                fakeRepository()
            )

            expect(out.decision).toBe('ALLOW')
        })
    })

    describe('assert', () => {
        it('resolves when access is allowed', async () => {
            await expect(
                run(service.assert(ctx, 'project', 'read'), fakeRepository())
            ).resolves.toBeUndefined()
        })

        it('fails with PermissionDenied, a forbidden domain error, on deny', async () => {
            const error = await run(
                service.assert(ctx, 'project', 'delete'),
                fakeRepository()
            ).catch((e: unknown) => e)

            expect(error).toMatchObject({
                _tag: 'PermissionDenied',
                kind: 'forbidden',
            })
            expect((error as { publicMessage: () => string }).publicMessage()).toEqual(expect.any(String))
        })
    })

    describe('buildWhereClause', () => {
        it('returns undefined when the role is unrestricted', async () => {
            const out = await run(
                service.buildWhereClause(
                    ctx,
                    'project',
                    'read',
                    {} as never,
                    vi.fn() as never
                ),
                fakeRepository()
            )

            expect(out).toBeUndefined()
        })

        it('returns a SQL predicate when the role has no matching rule', async () => {
            const out = await run(
                service.buildWhereClause(
                    ctx,
                    'project',
                    'delete',
                    {} as never,
                    vi.fn() as never
                ),
                fakeRepository()
            )

            expect(out).toBeDefined()
        })
    })

    describe('role rules CRUD', () => {
        it('delegates upsert to the repository', async () => {
            const repo = fakeRepository()

            await run(service.upsertRoleRules('developer', [readAllRule]), repo)

            expect(repo.upsertRoleRules).toHaveBeenCalledWith('developer', [
                readAllRule,
            ])
        })

        it('delegates delete to the repository', async () => {
            const repo = fakeRepository()

            await run(service.deleteRoleRules('developer'), repo)

            expect(repo.deleteRoleRules).toHaveBeenCalledWith('developer')
        })

        it('lists role rules from the repository', async () => {
            const repo = fakeRepository()

            const out = await run(service.listRoleRules(), repo)

            expect(out).toEqual([row])
            expect(repo.listRoleRules).toHaveBeenCalledWith()
        })

        it('lets a repository failure through unmapped', async () => {
            const repo = fakeRepository()
            repo.listRoleRules.mockImplementation(
                () =>
                    Effect.fail({
                        _tag: 'PermissionRepositoryFailure',
                        cause: new Error('db down'),
                    }) as never
            )

            const error = await run(service.listRoleRules(), repo).catch(
                (cause: unknown) => cause
            )

            expect(error).toMatchObject({ _tag: 'PermissionRepositoryFailure' })
            expect((error as { cause?: unknown }).cause).toBeInstanceOf(Error)
        })
    })

    describe('ForbiddenError static re-export', () => {
        it('exposes ForbiddenError from @deployer/auth', () => {
            expect(PermissionService.ForbiddenError).toBe(ForbiddenError)
        })
    })
})
