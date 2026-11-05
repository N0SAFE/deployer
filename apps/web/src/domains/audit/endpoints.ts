import { orpc } from '@/lib/orpc'

/**
 * Audit domain endpoints.
 *
 * `auditList` is the identity service's `GET /audit`; it is hoisted onto the root client by the contract base, so the
 * page calls the typed procedure rather than building a URL.
 */
export const auditEndpoints = {
    list: orpc.audit.list,
    export: orpc.audit.export,
} as const
