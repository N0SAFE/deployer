'use client'

import { useQuery } from '@tanstack/react-query'

import { auditEndpoints } from './endpoints'

import type { AuthAuditEventRow } from '@deployer/identity-contracts'

/** The filters the audit viewer sends; every one is optional and the server owns the defaults. */
export interface AuditFilters {
  readonly action?: string
  readonly actorId?: string
  readonly targetId?: string
  readonly limit?: number
  readonly beforeId?: number
}

/**
 * One page of auth audit events, newest first.
 *
 * The list is append-only, so it is cached for a moment rather than treated as live data: a viewer that needs the last
 * seconds refreshes.
 */
export function useAuditEvents(filters: AuditFilters, options: { enabled?: boolean } = {}) {
  return useQuery(
    auditEndpoints.list.queryOptions({
      input: {
        query: {
          ...(filters.action === undefined || filters.action === '' ? {} : { action: filters.action }),
          ...(filters.actorId === undefined || filters.actorId === '' ? {} : { actorId: filters.actorId }),
          ...(filters.targetId === undefined || filters.targetId === '' ? {} : { targetId: filters.targetId }),
          ...(filters.limit === undefined ? {} : { limit: filters.limit }),
          ...(filters.beforeId === undefined ? {} : { beforeId: filters.beforeId }),
        },
      },
      enabled: options.enabled ?? true,
      staleTime: 15_000,
      gcTime: 60_000,
    }),
  )
}


/** The row the contract's schema describes; the page formats it, it does not redefine it. */
export type AuditEvent = AuthAuditEventRow
