'use client'

import { useInfiniteQuery, useMutation } from '@tanstack/react-query'

import type { AuthAuditEventRow } from '@deployer/identity-contracts'

import { auditEndpoints } from './endpoints'

/** The filters the audit viewer sends; every one is optional and the server owns the defaults. */
export interface AuditFilters {
    readonly action?: string
    readonly actorId?: string
    readonly targetId?: string
    readonly limit?: number
    readonly beforeId?: number
}

/**
 * The audit log, newest first, paged with the id CURSOR the API exposes.
 *
 * Append-only data is cached for a moment rather than treated as live. Paging by `beforeId` (not offset) is what keeps
 * the pages stable while new events arrive at the head.
 */
export function useAuditEvents(
    filters: AuditFilters,
    options: { enabled?: boolean } = {}
) {
    return useInfiniteQuery(
        auditEndpoints.list.infiniteOptions({
            input: (beforeId: number | undefined) => ({
                query: {
                    ...(filters.action === undefined || filters.action === ''
                        ? {}
                        : { action: filters.action }),
                    ...(filters.actorId === undefined || filters.actorId === ''
                        ? {}
                        : { actorId: filters.actorId }),
                    ...(filters.targetId === undefined ||
                    filters.targetId === ''
                        ? {}
                        : { targetId: filters.targetId }),
                    ...(filters.limit === undefined
                        ? {}
                        : { limit: filters.limit }),
                    ...(beforeId === undefined ? {} : { beforeId }),
                },
            }),
            initialPageParam: undefined as number | undefined,
            getNextPageParam: (last) =>
                last.meta.hasMore
                    ? (last.data.at(-1)?.id ?? undefined)
                    : undefined,
            enabled: options.enabled ?? true,
            staleTime: 15_000,
            gcTime: 60_000,
        })
    )
}

/** The row the contract's schema describes; the page formats it, it does not redefine it. */
export type AuditEvent = AuthAuditEventRow

/**
 * The filtered export (`audit:export`).
 *
 * Server-side on purpose: the page only holds a page of rows, and the export must cover what the filters select, not
 * what has been scrolled into view. `truncated` means the 5000-row cap applied.
 */
export function useAuditExport() {
    return useMutation(auditEndpoints.export.mutationOptions({}))
}
