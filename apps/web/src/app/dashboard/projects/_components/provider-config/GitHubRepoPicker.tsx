'use client'

import { ExternalLink } from 'lucide-react'
import { Label } from '@deployer/ui/components/shadcn/label'
import { AuthDashboardAdminProvidersCodeGithub } from '@/routes'
import { SearchableSelect } from '../steps/searchable-select'

/** GitHub repository info from the OAuth-powered list endpoint. */
export interface GitHubRepo {
  id: number
  full_name: string
  html_url: string
  default_branch: string
  description: string | null
  private: boolean
}

/** Repo picker shown when the GitHub provider is selected. */
export function GitHubRepoPicker({
  repos,
  isLoading,
  selectedUrl,
  onSelect,
}: {
  repos: readonly GitHubRepo[]
  isLoading: boolean
  selectedUrl: string
  onSelect: (url: string, branch: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label>Repository</Label>
      <SearchableSelect
        value={selectedUrl}
        onChange={(val) => {
          const repo = repos.find((r) => r.html_url === val)
          if (repo) onSelect(repo.html_url, repo.default_branch)
        }}
        options={repos.map((repo) => ({
          value: repo.html_url,
          label: repo.full_name,
          description: repo.private ? 'Private repository' : repo.description ?? undefined,
          badge: repo.private ? 'private' : undefined,
        }))}
        placeholder={isLoading ? 'Loading repos…' : 'Search or select a repository…'}
        searchPlaceholder="Type to filter repositories…"
        emptyMessage="No repositories match."
      />
      {repos.length === 0 && !isLoading ? (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>No repositories found. Connect a GitHub App to access your repositories.</p>
          <AuthDashboardAdminProvidersCodeGithub.Link className="inline-flex items-center gap-1 text-primary underline">
            Configure GitHub provider <ExternalLink className="size-3" />
          </AuthDashboardAdminProvidersCodeGithub.Link>
        </div>
      ) : null}
    </div>
  )
}
