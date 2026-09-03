'use client'

import { useState } from 'react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Checkbox } from '@repo/ui/components/shadcn/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Field, FieldLabel, FieldDescription, FieldGroup, FieldSet, FieldLegend } from '@repo/ui/components/shadcn/field'
import { Plus, AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { SERVICE_PROVIDER_TYPES } from '@repo/contracts-common'
import { useGitHubApps, useGitHubRepos, useGitHubBranches } from '@/domains/github-apps/hooks'
import { githubAppEndpoints } from '@/domains/github-apps/endpoints'
import { AuthDashboardAdminProvidersCodeGithub } from '@/routes'
import type { CreateServiceFormApi, WizardFormData } from '../CreateService.hook'
import { useRunnerDetection } from './runner-detection-context'
import { runnerFromDetection } from './runner-presets'
import { SearchableSelect } from './searchable-select'

const AUTH_SECRET_OPTIONS = [
  { value: 'default', label: 'Default (built-in)' },
  { value: 'vault', label: 'HashiCorp Vault' },
  { value: 'aws-secrets-manager', label: 'AWS Secrets Manager' },
  { value: 'gcp-secret-manager', label: 'GCP Secret Manager' },
  { value: 'azure-key-vault', label: 'Azure Key Vault' },
] as const

const GIT_PROVIDERS = new Set(['github', 'gitlab', 'bitbucket'])
const IMAGE_PROVIDERS = new Set(['container-registry', 'artifact-bundle'])

export function StepProvider({ form }: { form: CreateServiceFormApi }) {
  return (
    <form.Subscribe selector={(s) => s.values.provider} children={(provider) => {
      const isGit = GIT_PROVIDERS.has(provider.providerId)
      const isImage = IMAGE_PROVIDERS.has(provider.providerId)

      return (
        <FieldSet>
          <FieldLegend>Source provider</FieldLegend>
          <FieldDescription>
            Choose where your service code or image comes from.
            {provider.providerId === 'github' && ' Select a configured GitHub App, then a repository.'}
          </FieldDescription>
          <FieldGroup>
            {/* Provider type selector */}
            <form.Field name="provider.providerId" children={(field) => (
              <Field>
                <FieldLabel>Provider type <span className="text-destructive">*</span></FieldLabel>
                <Select value={field.state.value} onValueChange={(v: typeof field.state.value) => {
                  const defaults =
                    v === 'github' ? { providerAppId: '', sourceUrl: '', branch: 'main', autoSyncEnabled: true, webhookEnabled: false, authSecretRef: 'default' } :
                    (v === 'gitlab' || v === 'bitbucket') ? { sourceUrl: '', branch: 'main', autoSyncEnabled: true, webhookEnabled: false, authSecretRef: 'default' } :
                    v === 'container-registry' ? { sourceUrl: '', authSecretRef: 'default' } :
                    v === 'artifact-bundle' ? { sourceUrl: '', authSecretRef: 'default' } :
                    { sourceUrl: '', autoSyncEnabled: true, authSecretRef: 'default' }
                  form.setFieldValue('provider', { providerId: v, config: defaults } as WizardFormData['provider'])
                }}>
                  <SelectTrigger id="prov-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SERVICE_PROVIDER_TYPES.map((p) => (<SelectItem key={p} value={p}>{p}</SelectItem>))}
                  </SelectContent>
                </Select>
              </Field>
            )} />

            {/* ── GitHub-specific: dynamic app → repo → branch picker ── */}
            {provider.providerId === 'github' && <GitHubSourcePicker form={form} />}

            {/* ── Git (non-GitHub): manual URL + branch ── */}
            {isGit && provider.providerId !== 'github' && (<>
              <form.Field name="provider.config.sourceUrl" children={(f) => (<Field><FieldLabel>Repository URL <span className="text-destructive">*</span></FieldLabel><Input value={f.state.value} onBlur={f.handleBlur} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="https://gitlab.com/org/repo" /></Field>)} />
              <form.Field name="provider.config.branch" children={(f) => (<Field><FieldLabel>Branch <span className="text-destructive">*</span></FieldLabel><Input value={f.state.value} onBlur={f.handleBlur} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="main" /></Field>)} />
            </>)}

            {/* ── Image provider: URL only ── */}
            {isImage && (
              <form.Field name="provider.config.sourceUrl" children={(f) => (
                <Field>
                  <FieldLabel>{provider.providerId === 'container-registry' ? 'Image URL' : 'Bundle download URL'} <span className="text-destructive">*</span></FieldLabel>
                  <Input value={f.state.value} onBlur={f.handleBlur} onChange={(e) => { f.handleChange(e.target.value) }} placeholder={provider.providerId === 'container-registry' ? 'nginx:latest' : 'https://storage.example.com/bundle.tar.gz'} />
                  <FieldDescription>{provider.providerId === 'container-registry' ? 'Full container image reference.' : 'URL to download the artifact archive from.'}</FieldDescription>
                </Field>
              )} />
            )}

            {/* ── Manual: free-form URL ── */}
            {provider.providerId === 'manual' && (
              <form.Field name="provider.config.sourceUrl" children={(f) => (<Field><FieldLabel>Source URL <span className="text-destructive">*</span></FieldLabel><Input value={f.state.value} onBlur={f.handleBlur} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="https://..." /></Field>)} />
            )}

            {/* ── Shared fields for git providers ── */}
            {isGit && (<>
              <form.Field name="provider.config.autoSyncEnabled" children={(f) => (<Field orientation="horizontal"><Checkbox checked={f.state.value} onCheckedChange={(c) => { f.handleChange(c === true) }} /><FieldLabel>Auto-sync source on push</FieldLabel></Field>)} />
              <form.Field name="provider.config.webhookEnabled" children={(f) => (<Field orientation="horizontal"><Checkbox checked={f.state.value} onCheckedChange={(c) => { f.handleChange(c === true) }} /><FieldLabel>Register webhook</FieldLabel></Field>)} />
            </>)}

            {/* ── Auth secret (all providers) ── */}
            <form.Field name="provider.config.authSecretRef" children={(f) => (
              <Field>
                <FieldLabel>Auth secret</FieldLabel>
                <Select value={f.state.value} onValueChange={(v) => { f.handleChange(v) }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AUTH_SECRET_OPTIONS.map((opt) => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </Field>
            )} />
          </FieldGroup>
        </FieldSet>
      )
    }} />
  )
}

/** ─── Dynamic GitHub picker: App → Repository → (branch auto-fill) ─── */
function GitHubSourcePicker({ form }: { form: CreateServiceFormApi }) {
  const { data: appsData, isLoading: appsLoading } = useGitHubApps()
  const apps = appsData?.apps ?? []

  return (
    <FieldGroup>
      {/* Provider app */}
      <Field>
        <FieldLabel>GitHub App <span className="text-destructive">*</span></FieldLabel>
        {appsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading apps…</div>
        ) : apps.length === 0 ? (
          <div className="space-y-3">
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>No GitHub App configured</AlertTitle>
              <AlertDescription>
                Connect a GitHub App first so this service can read your repositories.
              </AlertDescription>
            </Alert>
            <AuthDashboardAdminProvidersCodeGithub.Link>
              <Button type="button" size="sm" variant="outline" className="gap-1.5">
                <Plus className="size-3.5" /> Create GitHub App
              </Button>
            </AuthDashboardAdminProvidersCodeGithub.Link>
          </div>
        ) : (
          <div className="space-y-2">
            <form.Field name="provider.config.providerAppId" children={(f) => (
              <SearchableSelect
                value={f.state.value}
                onChange={(v) => { f.handleChange(v); form.setFieldValue('provider.config.sourceUrl', '') }}
                options={apps.map((a: { id: string; name: string; isActive: boolean }) => ({
                  value: a.id,
                  label: a.name,
                  badge: a.isActive ? undefined : 'inactive',
                }))}
                placeholder="Select a GitHub App"
                searchPlaceholder="Search apps…"
                emptyMessage="No GitHub App matches."
              />
            )} />
            <AuthDashboardAdminProvidersCodeGithub.Link>
              <Button type="button" size="sm" variant="ghost" className="gap-1.5 h-7 text-xs">
                <Plus className="size-3.5" /> Add another app
              </Button>
            </AuthDashboardAdminProvidersCodeGithub.Link>
          </div>
        )}
      </Field>

      {/* Repository picker — only shown when an app is selected */}
      <form.Subscribe selector={(s) => (s.values.provider.config as { providerAppId?: string }).providerAppId ?? ''} children={(appId) => (
        appId ? <RepoPickerForApp appId={appId} form={form} /> : null
      )} />
    </FieldGroup>
  )
}

/** Repo picker that loads repos for a specific GitHub App. */
function RepoPickerForApp({ appId, form }: { appId: string; form: CreateServiceFormApi }) {
  const { setDetection, setSource } = useRunnerDetection()
  const { data: reposRaw, isLoading: reposLoading, isError: reposError, refetch: refetchRepos } = useGitHubRepos(appId)
  const reposData = reposRaw as { repos: { full_name: string; html_url: string; default_branch: string; language: string | null; private: boolean }[]; _meta?: { installed?: boolean; appName?: string | null; message?: string } } | undefined
  const repos = reposData?.repos ?? []
  const meta = reposData?._meta
  const installUrl = meta?.appName
    ? `https://github.com/apps/${encodeURIComponent(meta.appName)}/installations/new`
    : `https://github.com/apps/${encodeURIComponent(appId)}/installations/new`
  const [detecting, setDetecting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedRepo, setSelectedRepo] = useState<{ owner: string; repo: string } | null>(null)

  // Load branches once a repo is selected (owner/repo parsed from full_name).
  const { data: branchesData, isLoading: branchesLoading, isError: branchesError, refetch: refetchBranches } = useGitHubBranches(
    selectedRepo?.owner,
    selectedRepo?.repo,
    appId,
  )
  const branches = branchesData?.branches ?? []

  const handleRetry = async () => {
    setRefreshing(true)
    try { await refetchRepos() } finally { setRefreshing(false) }
  }

  const handleRepoSelect = async (fullName: string) => {
    const repo = repos.find((r: { full_name: string }) => r.full_name === fullName)
    if (!repo) return
    form.setFieldValue('provider.config.sourceUrl', repo.html_url)
    form.setFieldValue('provider.config.branch', repo.default_branch)

    const [owner, repoName] = fullName.split('/')
    if (!owner || !repoName) return
    setSelectedRepo({ owner, repo: repoName })
    setSource({ owner, repo: repoName, appId })
    setDetecting(true)
    try {
      const result = await githubAppEndpoints.detectRunner.call({
        params: { owner, repo: repoName },
        query: { providerAppId: appId },
      })
      const builder = result.defaultBuilder ?? result.detected[0]?.builderId ?? null
      const hints = result.detected[0]?.config ?? null
      if (builder) {
        form.setFieldValue('runner', runnerFromDetection(builder, hints))
        setDetection(builder, hints)
      } else {
        setDetection(null, null)
      }
    } catch {
      // detection is best-effort
      setDetection(null, null)
    } finally {
      setDetecting(false)
    }
  }

  return (
    <>
      <Field>
        <FieldLabel>Repository <span className="text-destructive">*</span></FieldLabel>
        {reposLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading repositories…</div>
        ) : reposError ? (
          <div className="space-y-2">
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>Failed to load repositories</AlertTitle>
              <AlertDescription>
                Could not fetch repositories for this GitHub App. The app may have been removed, or
                GitHub is unreachable.
              </AlertDescription>
            </Alert>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => { void handleRetry() }} disabled={refreshing}>
              {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Retry
            </Button>
          </div>
        ) : meta && !meta.installed ? (
          <Alert>
            <AlertTriangle className="size-4" />
            <AlertTitle>App not installed</AlertTitle>
            <AlertDescription>
              {meta.message ?? 'This GitHub App is not yet installed on any repositories.'}{' '}
              Install it from the{' '}
              <a href={installUrl} target="_blank" rel="noopener noreferrer" className="underline">
                GitHub installation page
              </a>.
            </AlertDescription>
          </Alert>
        ) : repos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No repositories found for this app.</p>
        ) : (
          <div className="space-y-1.5">
            <SearchableSelect
              value={repos.find((r: { html_url: string }) => r.html_url === form.state.values.provider.config.sourceUrl)?.full_name ?? ''}
              onChange={(v) => { void handleRepoSelect(v) }}
              options={repos.map((r: { full_name: string; html_url: string; language: string | null; private: boolean }) => ({
                value: r.full_name,
                label: r.full_name,
                description: [r.language, r.private ? 'private' : null].filter(Boolean).join(' · ') || undefined,
              }))}
              placeholder="Search or select a repository…"
              searchPlaceholder="Type to search repositories…"
              emptyMessage="No repository matches."
              allowCustom={false}
            />
            {detecting && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Detecting runner builder…
              </p>
            )}
          </div>
        )}
      </Field>

      {/* Branch — loaded from the GitHub API once a repo is selected */}
      <form.Field name="provider.config.branch" children={(f) => (
        <Field>
          <FieldLabel>Branch <span className="text-destructive">*</span></FieldLabel>
          {!selectedRepo ? (
            <Input value={f.state.value} onBlur={f.handleBlur} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="Select a repository first" disabled />
          ) : branchesLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading branches…</div>
          ) : branchesError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">Failed to load branches.</p>
              <Button type="button" size="sm" variant="outline" onClick={() => { void refetchBranches() }}>Retry</Button>
            </div>
          ) : branches.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">No branches found for this repository.</p>
              <Input value={f.state.value} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="Type a branch name" />
            </div>
          ) : (
            <SearchableSelect
              value={f.state.value}
              onChange={(v: string) => { f.handleChange(v) }}
              options={branches.map((b) => ({ value: b.name, label: b.name }))}
              placeholder="Select a branch"
              searchPlaceholder="Type to search branches…"
              emptyMessage="No branch matches."
              allowCustom
            />
          )}
        </Field>
      )} />
    </>
  )
}
