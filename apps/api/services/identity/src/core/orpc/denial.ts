import type { DomainError } from '@deployer/effect-core'
import type { RequestContextInput } from '@deployer/effect-orpc'

/** One refusal, as the audit trail records it (`SEC-068`). */
export type DenialEvent = {
    readonly action: 'access-denied'
    readonly actorId?: string
    readonly ip?: string
    readonly userAgent?: string
    readonly detail: {
        readonly tag: string
        readonly kind: string
        readonly correlationId: string
        readonly message: string
    }
}

let denialSink: ((event: DenialEvent) => void) | undefined

/**
 * Where refusals go.
 *
 * Installed at boot by the audit module, because the sink needs the database. Until then (and in a spec that boots no
 * module) denials are answered exactly as before — the record is observability, never part of the decision.
 */
export const setDenialSink = (
    sink: ((event: DenialEvent) => void) | undefined
): void => {
    denialSink = sink
}

/** Only a REFUSAL is audit-worthy; a validation error is the caller's typo, not an access attempt. */
const AUDITED_KINDS = new Set<DomainError['kind']>([
    'forbidden',
    'unauthorized',
])

const header = (
    context: RequestContextInput,
    name: string
): string | undefined => {
    const headers = context.request?.headers
    if (headers === undefined) return undefined
    // `HeadersLike` is either a real `Headers` or a plain Node record; narrow before calling.
    if (typeof (headers as { get?: unknown }).get === 'function') {
        const value = (headers as { get(name: string): string | null }).get(
            name
        )
        return value === null || value === '' ? undefined : value
    }
    const value = (
        headers as Record<string, string | readonly string[] | undefined>
    )[name]
    return typeof value === 'string' ? value : value?.[0]
}

export const reportDenial = (
    context: RequestContextInput,
    error: DomainError,
    correlationId: string
): void => {
    if (denialSink === undefined || !AUDITED_KINDS.has(error.kind)) return

    const actorId = context.auth?.user?.id
    denialSink({
        action: 'access-denied',
        ...(actorId === undefined ? {} : { actorId }),
        ...(header(context, 'x-forwarded-for') === undefined
            ? {}
            : { ip: header(context, 'x-forwarded-for') }),
        ...(header(context, 'user-agent') === undefined
            ? {}
            : { userAgent: header(context, 'user-agent') }),
        detail: {
            tag: error._tag,
            kind: error.kind,
            correlationId,
            message: error.publicMessage(),
        },
    })
}
