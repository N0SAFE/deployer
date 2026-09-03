import { orpc } from '@/lib/orpc'

export const githubAppEndpoints = {
  list: orpc.providers.code.github.list,
  create: orpc.providers.code.github.create,
  update: orpc.providers.code.github.update,
  delete: orpc.providers.code.github.delete,
  oauthInit: orpc.providers.code.github.oauthInit,
  listRepos: orpc.providers.code.github.listRepos,
  listBranches: orpc.providers.code.github.listBranches,
  detectRunner: orpc.providers.code.github.detectRunner,
  installCallback: orpc.providers.code.github.installCallback,
  selfCheck: orpc.providers.code.github.selfCheck,
  manifestInit: orpc.providers.code.github.manifestInit,
  manifestCallback: orpc.providers.code.github.manifestCallback,
  createFromPat: orpc.providers.code.github.createFromPat,
} as const

export type GitHubAppEndpoints = typeof githubAppEndpoints
