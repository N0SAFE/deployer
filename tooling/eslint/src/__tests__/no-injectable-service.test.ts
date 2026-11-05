import { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'

import { createNoInjectableServiceRule } from '../rules/no-injectable-service'

const lint = (code: string, options: unknown[] = []) =>
    new Linter().verify(
        code,
        [
            {
                files: ['**/*.ts'],
                languageOptions: { parser: tseslint.parser },
                plugins: {
                    local: {
                        rules: {
                            noInjectableService:
                                createNoInjectableServiceRule(),
                        },
                    },
                },
                rules: { 'local/noInjectableService': ['error', ...options] },
            },
        ],
        { filename: 'x.ts' }
    )

const names = (code: string, options?: unknown[]) =>
    lint(code, options).map((m) => m.message.match(/`(\w+)`/)?.[1])

describe('no-injectable-service', () => {
    it('reports an @Injectable() service, at the class name', () => {
        const [found] = lint('@Injectable()\nexport class ClusterService {}\n')
        expect(found).toMatchObject({
            line: 2,
            column: 14,
            messageId: 'injectableService',
        })
        expect(found?.message).toContain('Context.Service')
        expect(found?.message).toContain('useValue: ClusterService.live')
    })

    it('reports it however the decorator is spelt', () => {
        expect(names('@Injectable class A {}')).toEqual(['A'])
        expect(
            names('@Injectable({ scope: Scope.REQUEST }) class B {}')
        ).toEqual(['B'])
        expect(names('@common.Injectable() class C {}')).toEqual(['C'])
    })

    it('reports a service whatever folder it is filed in or what it is called', () => {
        expect(names('@Injectable() class ReplicaStore {}')).toEqual([
            'ReplicaStore',
        ])
        expect(names('@Injectable() class DockerEngineClient {}')).toEqual([
            'DockerEngineClient',
        ])
    })

    it('ignores a class with no @Injectable', () => {
        expect(
            lint('export class Plain {}\n@Controller() class C {}\n')
        ).toEqual([])
    })

    it('has no exemptions: a guard, interceptor, pipe, filter or middleware is a Nest role the integration replaces', () => {
        for (const name of [
            'AuthGuard',
            'LoggingInterceptor',
            'ParsePipe',
            'HttpFilter',
            'RequestMiddleware',
            'JwtStrategy',
            'EventsGateway',
        ]) {
            expect(names(`@Injectable() class ${name} {}`)).toEqual([name])
        }
        expect(
            names('@Injectable() class Whatever implements CanActivate {}')
        ).toEqual(['Whatever'])
        expect(
            names('@Injectable() class Whatever implements NestMiddleware {}')
        ).toEqual(['Whatever'])
    })

    it('still reports a service that merely implements something else', () => {
        expect(
            names('@Injectable() class Boot implements OnModuleInit {}')
        ).toEqual(['Boot'])
    })

    it('honours the named allow-list', () => {
        expect(
            lint('@Injectable() class SwarmEventsHub {}', [
                { allow: ['SwarmEventsHub'] },
            ])
        ).toEqual([])
        expect(
            names('@Injectable() class Other {}', [
                { allow: ['SwarmEventsHub'] },
            ])
        ).toEqual(['Other'])
    })

    it('rejects an unknown option', () => {
        expect(() => lint('class A {}', [{ alow: [] }])).toThrow()
    })
})
