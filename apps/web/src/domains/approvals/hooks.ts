'use client'

import { useMutation, useQuery } from '@tanstack/react-query'

import { approvalEndpoints } from './endpoints'

/** One request, as the ledger stores it. */
export interface ApprovalRequest {
  id: string
  permission: string
  requesterId: string
  via: string | null
  scope: Record<string, unknown>
  actionHash: string
  reason: string
  requiredApprovals: number
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'consumed'
  ttlSec: number
  expiresAt: Date
  consumedAt: Date | null
  createdAt: Date
  approvals: number
}

/** Pending requests an approver can work through. */
export function usePendingApprovals(options: { enabled?: boolean } = {}) {
  return useQuery(
    approvalEndpoints.list.queryOptions({
      input: { query: { status: 'pending', limit: 50 } },
      enabled: options.enabled ?? true,
      staleTime: 15_000,
    }),
  )
}

/** Approve or deny. The caller reloads afterwards; a deny closes the request immediately. */
export function useDecideApproval() {
  return useMutation(approvalEndpoints.decide.mutationOptions({}))
}
