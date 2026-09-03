'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { gitlabAppEndpoints } from './endpoints'

export function useGitlabApps() {
  return useQuery(gitlabAppEndpoints.list.queryOptions({ input: {} }))
}

export function useCreateGitlabApp() {
  return useMutation(gitlabAppEndpoints.create.mutationOptions())
}

export function useDeleteGitlabApp() {
  return useMutation(gitlabAppEndpoints.delete.mutationOptions())
}
