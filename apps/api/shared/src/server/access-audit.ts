import { INTERCEPTORS_METADATA } from '@nestjs/common/constants'
import { ModulesContainer } from '@nestjs/core'
import { ImplementInterceptor } from '@orpc/nest'

import { logger } from '@deployer/logger'
import {
    assertAccessDeclared,
    auditRouter,
    type AccessAudit,
} from '@deployer/nest-effect'

import type { INestApplication } from '@nestjs/common'

/** The part of a Nest module the audit reads: its controllers and their live instances. */
export type AuditedModule = {
    readonly controllers: {
        values(): Iterable<{
            readonly instance?: unknown
            readonly metatype?: unknown
        }>
    }
}

/** `@Implement(...)` binds a method to a contract through `ImplementInterceptor`; nothing else carries it. */
function isImplemented(member: unknown): boolean {
    const interceptors: unknown = Reflect.getMetadata(INTERCEPTORS_METADATA, member as object)
    return Array.isArray(interceptors) && interceptors.includes(ImplementInterceptor)
}

function isPromise(value: unknown): boolean {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof Reflect.get(value, 'then') === 'function'
    )
}

/**
 * Which mounted oRPC procedures declared their access.
 *
 * Only methods bound by `@Implement(...)` are called (each returns an implemented procedure, which is how the host mounts
 * it), so a plain HTTP controller route is never invoked. A router contract bound to one method returns a promise and is
 * reported as unauditable rather than awaited.
 */
export function auditModules(modules: Iterable<AuditedModule>): {
    readonly audit: AccessAudit
    readonly unauditable: readonly string[]
} {
    const router: Record<string, unknown> = {}
    const unauditable: string[] = []
    for (const module of modules) {
        for (const wrapper of module.controllers.values()) {
            const instance = wrapper.instance
            if (instance === null || typeof instance !== 'object') continue
            const owner =
                typeof wrapper.metatype === 'function'
                    ? wrapper.metatype.name
                    : instance.constructor.name
            let proto = Reflect.getPrototypeOf(instance)
            while (proto !== null && proto !== Object.prototype) {
                for (const name of Object.getOwnPropertyNames(proto)) {
                    if (name === 'constructor') continue
                    const member: unknown = Reflect.get(instance, name)
                    if (typeof member !== 'function' || !isImplemented(member)) continue
                    const path = `${owner}.${name}`
                    try {
                        const result: unknown = Reflect.apply(member, instance, [])
                        if (isPromise(result)) unauditable.push(path)
                        else router[path] = result
                    } catch {
                        unauditable.push(path)
                    }
                }
                proto = Reflect.getPrototypeOf(proto)
            }
        }
    }
    return { audit: auditRouter(router), unauditable }
}

export type AccessAuditMode = 'off' | 'report' | 'strict'

/** `ACCESS_AUDIT=off|report|strict`; `report` is the default so an unconverted app still boots and says what is left. */
export function accessAuditMode(raw = process.env.ACCESS_AUDIT): AccessAuditMode {
    const value = raw?.trim().toLowerCase()
    return value === 'off' || value === 'strict' ? value : 'report'
}

/**
 * The boot rule for access declarations (`AUTHZ-011`).
 *
 * `report` logs how many procedures declared access and which did not; `strict` refuses to start on any undeclared
 * procedure that is not in the ledger, and on a ledger entry that no longer needs to be there. The ledger only shrinks
 * (`AUTHZ-012`); when it is empty `strict` is the target state.
 */
export function enforceAccessAudit(
    modules: Iterable<AuditedModule>,
    options: { readonly ledger?: readonly string[]; readonly mode?: AccessAuditMode } = {}
): void {
    const mode = options.mode ?? accessAuditMode()
    if (mode === 'off') return
    const { audit, unauditable } = auditModules(modules)
    const verdict = assertAccessDeclared(audit, options.ledger ?? [])
    const log = logger.scope('access-audit')
    log.info(
        `${String(audit.declared.length)} procedures declare access, ${String(audit.undeclared.length)} do not` +
            (audit.publicSurface.length === 0 ? '' : `, ${String(audit.publicSurface.length)} public`) +
            (unauditable.length === 0 ? '' : `, ${String(unauditable.length)} not auditable`)
    )
    if (verdict.violations.length > 0) {
        log.debug(`undeclared: ${verdict.violations.join(', ')}`)
    }
    if (mode === 'strict' && (verdict.violations.length > 0 || verdict.stale.length > 0)) {
        throw new Error(
            [
                verdict.violations.length > 0
                    ? `procedures with no access middleware: ${verdict.violations.join(', ')}`
                    : '',
                verdict.stale.length > 0
                    ? `ledger entries that are declared now (remove them): ${verdict.stale.join(', ')}`
                    : '',
            ]
                .filter(Boolean)
                .join('; ')
        )
    }
}

/** The modules of a running Nest app, as the audit reads them. */
export function modulesOf(app: INestApplication): Iterable<AuditedModule> {
    return app.get(ModulesContainer, { strict: false }).values()
}
