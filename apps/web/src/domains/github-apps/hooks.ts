'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { githubAppEndpoints } from './endpoints'

export function useGitHubApps() {
  return useQuery(githubAppEndpoints.list.queryOptions({ input: {} }))
}

export function useCreateGitHubApp() {
  return useMutation(githubAppEndpoints.create.mutationOptions())
}

export function useUpdateGitHubApp() {
  return useMutation(githubAppEndpoints.update.mutationOptions())
}

export function useDeleteGitHubApp() {
  return useMutation(githubAppEndpoints.delete.mutationOptions())
}

export function useGitHubOAuthInit() {
  return useMutation(githubAppEndpoints.oauthInit.mutationOptions())
}

export function useGitHubRepos(providerAppId?: string) {
  return useQuery({
    ...githubAppEndpoints.listRepos.queryOptions({
      input: providerAppId ? { query: { providerAppId } } : ({} as never),
    }),
    enabled: !!providerAppId,
  })
}

/** List branches of a repo. Enabled once both owner+repo are selected. */
export function useGitHubBranches(owner?: string, repo?: string, providerAppId?: string) {
  return useQuery({
    ...githubAppEndpoints.listBranches.queryOptions({
      input: {
        params: { owner: owner ?? '', repo: repo ?? '' },
        query: providerAppId ? { providerAppId } : {},
      },
    }),
    enabled: !!owner && !!repo && !!providerAppId,
  })
}

export function useGitHubSelfCheck() {
  return useQuery(githubAppEndpoints.selfCheck.queryOptions({ input: {} }))
}

export function useDetectRunner(owner?: string, repo?: string, providerAppId?: string) {
  return useQuery({
    ...githubAppEndpoints.detectRunner.queryOptions({
      input: {
        params: { owner: owner ?? '', repo: repo ?? '' },
        query: providerAppId ? { providerAppId } : {},
      },
    }),
    enabled: !!owner && !!repo && !!providerAppId,
  })
}

export function useGitHubManifestInit() {
  return useMutation(githubAppEndpoints.manifestInit.mutationOptions())
}

export function useGitHubManifestCallback() {
  return useMutation(githubAppEndpoints.manifestCallback.mutationOptions())
}

/** Persist the installation id after the user installs the GitHub App. */
export function useGitHubInstallCallback() {
  return useMutation(githubAppEndpoints.installCallback.mutationOptions())
}

export function useGitHubCreateFromPat() {
  return useMutation(githubAppEndpoints.createFromPat.mutationOptions())
}
