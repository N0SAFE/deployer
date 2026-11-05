import { orpc } from '@/lib/orpc'

/**
 * Approval endpoints (`SEC-072`).
 *
 * The list is what an approver works from; `decide` needs `approval:approve` plus a fresh passkey proof, both enforced
 * by the API.
 */
export const approvalEndpoints = {
    list: orpc.approval.list,
    request: orpc.approval.request,
    decide: orpc.approval.decide,
} as const
