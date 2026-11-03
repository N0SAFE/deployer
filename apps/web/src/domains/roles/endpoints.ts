import { orpc } from '@/lib/orpc'

/** Role catalogue + custom-role management (`SEC-054`). */
export const roleEndpoints = {
  list: orpc.role.list,
  create: orpc.role.create,
  update: orpc.role.update,
  remove: orpc.role.delete,
} as const
