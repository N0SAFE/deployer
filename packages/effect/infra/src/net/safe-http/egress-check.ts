import { stripBrackets } from '../address'
import { classifyAddress, type AddressClass } from '../ip-policy'

import { EgressDenied } from './errors'
import { EgressPolicy } from './policy'
import { ResolvedAddress } from './types'

export const defaultResolve = async (
    host: string
): Promise<readonly ResolvedAddress[]> =>
    (await Bun.dns.lookup(host)).map(({ address }) => ({ address }))

export const DENIED_BY_POLICY: ReadonlySet<AddressClass> =
    new Set<AddressClass>([
        'loopback',
        'private',
        'link-local',
        'cgnat',
        'unspecified',
        'multicast',
        'reserved',
    ])

/** Returns the reason an address is refused under the policy, or `undefined` when it is allowed. */
export const denyReason = (
    address: string,
    policy: EgressPolicy
): string | undefined => {
    const klass = classifyAddress(address)
    if (klass === 'invalid') return `unparseable address ${address}`
    if (
        klass === 'metadata' &&
        (policy.denyMetadata ||
            (policy.denyClasses === undefined && policy.denyPrivate))
    ) {
        return `metadata address ${address}`
    }
    if (policy.denyClasses !== undefined) {
        return policy.denyClasses.includes(klass)
            ? `${klass} address ${address}`
            : undefined
    }
    if (policy.denyPrivate && DENIED_BY_POLICY.has(klass))
        return `${klass} address ${address}`
    return undefined
}

export const hostAllowed = (
    host: string,
    allow: EgressPolicy['allowHosts']
): boolean => {
    if (allow === undefined || allow.length === 0) return true
    const h = host.toLowerCase()
    return allow.some((entry) => {
        const e = entry.toLowerCase()
        return e.startsWith('*.')
            ? h.endsWith(e.slice(1)) && h.length > e.length - 1
            : h === e
    })
}

/** Validate scheme, host allow-list and credentials. Addresses are validated after resolution. */
export const checkTarget = (
    url: URL,
    policy: EgressPolicy
): EgressDenied | undefined => {
    const scheme = url.protocol.replace(/:$/, '')
    if (scheme !== 'http' && scheme !== 'https')
        return new EgressDenied({
            url: url.href,
            reason: `scheme ${scheme} not allowed`,
        })
    if (!policy.schemes.includes(scheme))
        return new EgressDenied({
            url: url.href,
            reason: `scheme ${scheme} not allowed`,
        })
    if (url.username !== '' || url.password !== '')
        return new EgressDenied({ url: url.href, reason: 'credentials in URL' })
    const host = stripBrackets(url.hostname)
    if (!hostAllowed(host, policy.allowHosts))
        return new EgressDenied({
            url: url.href,
            reason: `host ${host} not in allow-list`,
        })
    return undefined
}
