import { orpc } from '@/lib/orpc'

/**
 * Role domain endpoints.
 *
 * The catalogue the API seeds from `SYSTEM_ROLES_TABLE` — the picker renders what the server says exists, instead of a
 * second copy of the role list in the browser.
 */
export const roleEndpoints = {
    list: orpc.role.list,
} as const
