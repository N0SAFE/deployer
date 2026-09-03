import { orpc } from '@/lib/orpc'

export const gitlabAppEndpoints = {
  list: orpc.providers.code.gitlab.list,
  create: orpc.providers.code.gitlab.create,
  delete: orpc.providers.code.gitlab.delete,
} as const

export type GitlabAppEndpoints = typeof gitlabAppEndpoints
