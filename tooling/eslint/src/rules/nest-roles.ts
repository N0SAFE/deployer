/**
 * One rule per Nest concept that the Effect + oRPC integration replaces.
 *
 * Nest solved "attach behaviour to a class" with decorators and framework interfaces; here that behaviour is code that carries
 * its own types (`docs/architecture/effect-orpc-conventions.md`). A role is recognised by what it IMPORTS: the decorator
 * (`UseGuards`), the interface (`CanActivate`) and the token (`APP_GUARD`) all come from a Nest package, so banning the import
 * catches a role however it is spelt, in a type position or a value position, with no type information — which keeps every one
 * of these rules runnable natively under `bun lint`.
 *
 * Each rule is its own rule (not one rule with a "kind" option) because each one is adopted, allow-listed and finally switched
 * on independently, and because the message must say what to write INSTEAD, which differs per concept.
 */
import type { Rule } from 'eslint'

interface ImportNode {
    readonly type: string
    readonly source: { readonly value?: unknown }
    readonly specifiers: readonly {
        readonly type: string
        readonly imported?: { readonly name?: string }
    }[]
}

/** Which names to ban from which module. `names: undefined` bans every import from it. */
interface Source {
    readonly module: string | RegExp
    readonly names?: readonly string[]
}

interface RoleSpec {
    /** What it is called in Nest: "guard", "pipe", … — the first word of the message. */
    readonly role: string
    readonly sources: readonly Source[]
    /** What to write instead; ends the message. */
    readonly instead: string
}

const matches = (module: string | RegExp, value: string): boolean =>
    typeof module === 'string' ? module === value : module.test(value)

/** Build one rule from a spec. */
function createNestRoleRule(spec: RoleSpec): Rule.RuleModule {
    return {
        meta: {
            type: 'problem',
            docs: {
                description: `A Nest ${spec.role} is replaced by the Effect + oRPC integration: ${spec.instead}`,
            },
            schema: [],
            messages: {
                nestRole: `\`{{name}}\` is a Nest ${spec.role}. ${spec.instead} (docs/architecture/effect-orpc-conventions.md)`,
            },
        },

        create(context) {
            return {
                ImportDeclaration(raw) {
                    const declaration = raw as unknown as ImportNode
                    const from = declaration.source.value
                    if (typeof from !== 'string') return

                    const source = spec.sources.find((candidate) =>
                        matches(candidate.module, from)
                    )
                    if (source === undefined) return

                    // A whole-package ban (`@nestjs/passport`, `@nestjs/websockets`): the import itself is the violation.
                    if (source.names === undefined) {
                        context.report({
                            node: raw,
                            messageId: 'nestRole',
                            data: { name: from },
                        })
                        return
                    }

                    const banned = new Set(source.names)
                    for (const specifier of declaration.specifiers) {
                        const name =
                            specifier.type === 'ImportSpecifier'
                                ? specifier.imported?.name
                                : undefined
                        if (name !== undefined && banned.has(name)) {
                            context.report({
                                node: specifier as unknown as Rule.Node,
                                messageId: 'nestRole',
                                data: { name },
                            })
                        }
                    }
                },
            }
        },
    }
}

const COMMON = '@nestjs/common'
const CORE = '@nestjs/core'

/** Nest's built-in HTTP exceptions: throwing one is a framework status, not a typed domain failure. */
const HTTP_EXCEPTIONS = [
    'HttpException',
    'BadRequestException',
    'UnauthorizedException',
    'NotFoundException',
    'ForbiddenException',
    'NotAcceptableException',
    'RequestTimeoutException',
    'ConflictException',
    'GoneException',
    'HttpVersionNotSupportedException',
    'PayloadTooLargeException',
    'UnsupportedMediaTypeException',
    'UnprocessableEntityException',
    'InternalServerErrorException',
    'NotImplementedException',
    'ImATeapotException',
    'MethodNotAllowedException',
    'BadGatewayException',
    'ServiceUnavailableException',
    'GatewayTimeoutException',
    'PreconditionFailedException',
] as const

/** The specs, keyed by the rule name they become. */
export const NEST_ROLE_SPECS = {
    noNestLifecycleHook: {
        role: 'lifecycle hook',
        sources: [
            {
                module: COMMON,
                names: [
                    'OnModuleInit',
                    'OnModuleDestroy',
                    'OnApplicationBootstrap',
                    'OnApplicationShutdown',
                    'BeforeApplicationShutdown',
                ],
            },
        ],
        instead:
            "Declare `onStart` / `run` / `onStop` in the service's shape and bind it with `serviceLifecycle(Tag)`: the service states its lifetime where it states everything else, and nothing stops while the work that uses it may still be running",
    },
    noNestGuard: {
        role: 'guard',
        sources: [
            { module: COMMON, names: ['UseGuards', 'CanActivate'] },
            { module: CORE, names: ['APP_GUARD'] },
        ],
        instead:
            'Declare the requirement in the controller with `accessRequired(...)` (`docs/architecture/access-requirements.md`; until it lands, `.meta(access({ permission }))` on the contract and `authzGate`), and use `requireAuth()` / `requireMesh()` for the common shapes',
    },
    noPassport: {
        role: 'Passport strategy',
        sources: [{ module: /^(@nestjs\/passport|passport(-.+)?)$/ }],
        instead:
            'Resolve the credential to an `Actor` in the oRPC auth middleware (session cookie, `dk_…` API key, mesh internal key) and let the access requirement decide; a credential kind is a function, not a class with `validate()`',
    },
    noNestPipe: {
        role: 'pipe',
        sources: [
            {
                module: COMMON,
                names: [
                    'UsePipes',
                    'PipeTransform',
                    'ValidationPipe',
                    'ParseIntPipe',
                    'ParseFloatPipe',
                    'ParseBoolPipe',
                    'ParseArrayPipe',
                    'ParseUUIDPipe',
                    'ParseEnumPipe',
                    'ParseDatePipe',
                    'ParseFilePipe',
                    'DefaultValuePipe',
                ],
            },
            { module: CORE, names: ['APP_PIPE'] },
        ],
        instead:
            "Validation and coercion are the contract's zod schema (`standard.zod`); oRPC parses input before the handler runs, so the handler receives a typed, valid value",
    },
    noNestInterceptor: {
        role: 'interceptor',
        sources: [
            {
                module: COMMON,
                names: ['UseInterceptors', 'NestInterceptor', 'CallHandler'],
            },
            { module: CORE, names: ['APP_INTERCEPTOR'] },
        ],
        instead:
            'Use an oRPC middleware (`.use(...)`) around a procedure, or an Effect combinator (`Effect.withSpan`, `annotateLogs`, `timeout`) around the work',
    },
    noNestExceptionFilter: {
        role: 'exception filter or HTTP exception',
        sources: [
            {
                module: COMMON,
                names: [
                    'Catch',
                    'ExceptionFilter',
                    'UseFilters',
                    'ArgumentsHost',
                    ...HTTP_EXCEPTIONS,
                ],
            },
            { module: CORE, names: ['APP_FILTER', 'BaseExceptionFilter'] },
        ],
        instead:
            'Fail with a tagged `domainError(tag, kind)`; the transport maps its kind to one status (`mapDomainError`), so there is nothing to catch and nothing to throw',
    },
    noNestMiddleware: {
        role: 'middleware',
        sources: [
            {
                module: COMMON,
                names: ['NestMiddleware', 'MiddlewareConsumer', 'NestModule'],
            },
        ],
        instead:
            'Inside a procedure use an oRPC middleware; before oRPC write a plain `(req, res, next)` function and mount it from the HTTP edge (`mountHttpEdge`, `server/http-edge.ts`) — no class, no `configure(consumer)`',
    },
    noNestRequestScope: {
        role: 'request-scoped provider',
        sources: [
            { module: COMMON, names: ['Scope'] },
            {
                module: CORE,
                names: ['REQUEST', 'INQUIRER', 'ContextIdFactory'],
            },
        ],
        instead:
            'A service stays a singleton and reads the request from the Effect context (`CurrentActor`, `Correlation`, `HttpRequest`), which only the request boundary can provide',
    },
    noNestGateway: {
        role: 'gateway',
        sources: [
            {
                module: /^@nestjs\/(websockets|platform-socket\.io|platform-ws)$/,
            },
        ],
        instead:
            'Realtime is an oRPC streaming procedure: the handler returns an `Observable`, and the transport frames it as an event iterator',
    },
} as const satisfies Record<string, RoleSpec>

export type NestRoleRuleName = keyof typeof NEST_ROLE_SPECS

export const NEST_ROLE_RULE_NAMES = Object.keys(
    NEST_ROLE_SPECS
) as NestRoleRuleName[]

/** Every role rule, ready to register under a plugin. */
export function createNestRoleRules(): Record<
    NestRoleRuleName,
    Rule.RuleModule
> {
    return Object.fromEntries(
        NEST_ROLE_RULE_NAMES.map((name) => [
            name,
            createNestRoleRule(NEST_ROLE_SPECS[name]),
        ])
    ) as Record<NestRoleRuleName, Rule.RuleModule>
}
