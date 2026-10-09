'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useService } from '@/domains/service/hooks'
import { useDeploymentList, useServicePreviews, usePromoteServicePreview } from '@/domains/deployment/hooks'
import { useServiceDomains } from '@/domains/domain/hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { PageSkeleton } from '@/components/dashboard/Skeletons'
import { InlineError } from '../../../../_components/workload/WorkloadStates'
import { RelativeTime } from '../../../../_components/workload/RelativeTime'
import { IdChip } from '../../../../_components/workload/CopyButton'
import { Eye, ExternalLink, Globe, Timer, Webhook, ArrowUp } from 'lucide-react'
import { EmptyState, StatusBadge } from '@/components/dashboard'
import { toast } from 'sonner'
import { useNow } from '@/components/dashboard/use-now'
import type { Deployment } from '@repo/contracts-entities'
import { formatDate } from '../../../_utils/helpers'
import { defaultPreviewPattern, resolvePreviewUrlPattern } from '../../../_utils/previewUrl'

interface PreviewEnvironment {
  id: string
  subdomain: string
  fullDomain: string
  sslEnabled: boolean
  isActive: boolean
  webhookTriggered: boolean
  expiresAt: string | null
  deploymentId: string | null
  metadata?: {
    pullRequestUrl?: string | null
    branchName?: string | null
    lastAccessedAt?: string | null
    accessCount?: number | null
  } | null
  createdAt: string
  updatedAt: string
}

type PreviewDeployment = Deployment

function daysLeft(expiresAt: string | null, now: number): number | null {
  if (!expiresAt) return null
  const diff = new Date(expiresAt).getTime() - now
  return Math.ceil(diff / (24 * 60 * 60 * 1000))
}

export default function DashboardServicePreviewsPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId
  const serviceId = params.serviceId

  const now = useNow(60_000)
  const { data: serviceData, isLoading: serviceLoading, error: serviceError, refetch: refetchService } = useService(serviceId)
  const { data: serviceDomainsData } = useServiceDomains(serviceId)
  const { data: deploymentsData } = useDeploymentList({
    query: { filter: { projectId: { operator: 'eq' as const, value: projectId } }, limit: 50, offset: 0 },
  })
  const { data: previewsData, error: previewsError, refetch: refetchPreviews } = useServicePreviews(serviceId)

  // Primary domain mapping (used as the preview base when no explicit URL is stored).
  const primaryDomain = useMemo(() => {
    const mappings = (serviceDomainsData ?? []) as { fullUrl: string; subdomain: string | null; isPrimary: boolean }[]
    return mappings.find((m) => m.isPrimary) ?? mappings[0] ?? null
  }, [serviceDomainsData])

  const previewDeployments = useMemo(() => {
    if (!deploymentsData?.data) return []
    return deploymentsData.data.filter((d) => d.environment === 'preview' && d.serviceId === serviceId)
  }, [deploymentsData, serviceId])

  // Real preview-environments rows (provisioned by PreviewProvisioningService).
  const previewEnvironments: PreviewEnvironment[] = useMemo(
    () => (previewsData?.previews ?? []) as PreviewEnvironment[],
    [previewsData],
  )

  const previewBase = primaryDomain?.fullUrl ?? null

  const promotePreview = usePromoteServicePreview()

  const handlePromote = async (previewName: string, subdomain: string) => {
    try {
      await promotePreview.mutateAsync({
        params: { serviceId },
        body: { previewName: subdomain },
      })
      toast.success(`Preview promoted to a stable domain: ${previewName}`)
    } catch (err) {
      toast.error('Failed to promote preview', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  const resolvePreviewUrl = (dep: PreviewDeployment): string | null => {
    // 1. Explicit URL stored on the deployment.
    const meta = dep.metadata ?? {}
    const stored = dep.domainUrl ?? (typeof meta.resolvedUrl === 'string' ? meta.resolvedUrl : null) ?? (typeof meta.previewUrl === 'string' ? meta.previewUrl : null)
    if (stored) return stored
    // 2. Compute from branch/PR against the service's primary domain.
    if (!previewBase) return null
    const branch = dep.sourceConfig?.branch ?? (typeof meta.branchName === 'string' ? meta.branchName : null)
    const prNumber = dep.sourceConfig?.pullRequestNumber ?? (typeof meta.prNumber === 'number' ? meta.prNumber : null)
    const host = previewBase.replace(/^https?:\/\//, '')
    const pattern = defaultPreviewPattern(host)
    return `https://${resolvePreviewUrlPattern(pattern, { serviceId, branchName: branch, prNumber })}`
  }

  if (serviceLoading) return <PageSkeleton label="Loading previews" blocks={1} withStrip={false} />
  if (serviceError) return <InlineError title="Could not load this service" error={serviceError} onRetry={() => void refetchService()} />
  if (!serviceData) return <InlineError title="Service not found" error={new Error('It does not exist or has been deleted.')} />

  const service = serviceData

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Preview Environments</CardTitle>
          <CardDescription>Branch-based preview deployments for <strong>{service.name}</strong>.</CardDescription>
        </CardHeader>
        <CardContent>
          {previewBase && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
              <Globe className="size-4 text-primary" />
              <span className="text-muted-foreground">Previews resolve from your primary domain:</span>
              <code className="font-mono font-medium text-foreground">{previewBase}</code>
            </div>
          )}

          {previewsError ? (
            <div className="mb-4"><InlineError title="Could not load provisioned previews" error={previewsError} onRetry={() => void refetchPreviews()} /></div>
          ) : null}

          {/* Live preview environments (preview_environments read model) */}
          {previewEnvironments.length > 0 && (
            <div className="mb-6 space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Provisioned previews</p>
              {previewEnvironments.map((p) => {
                const expired = p.expiresAt ? new Date(p.expiresAt).getTime() < now : false
                const remaining = daysLeft(p.expiresAt, now)
                return (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant={p.isActive && !expired ? 'default' : 'secondary'}>{p.isActive && !expired ? 'Active' : 'Expired'}</Badge>
                      {p.webhookTriggered && (
                        <Badge variant="outline" className="gap-1">
                          <Webhook className="size-3" /> Webhook
                        </Badge>
                      )}
                      <a
                        href={`https://${p.fullDomain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-sm text-primary hover:underline"
                      >
                        {p.fullDomain}
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
                      {p.metadata?.branchName && <span>branch: {p.metadata.branchName}</span>}
                      {p.metadata?.accessCount != null && <span>{p.metadata.accessCount} visits</span>}
                      {remaining != null && (
                        <span className="inline-flex items-center gap-1">
                          <Timer className="size-3" />
                          {expired ? 'expired' : `${String(remaining)}d left`}
                        </span>
                      )}
                      <span>{formatDate(p.createdAt)}</span>
                    </div>
                    {p.isActive && !expired && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 gap-1"
                        disabled={promotePreview.isPending}
                        onClick={() => { void handlePromote(p.fullDomain, p.subdomain) }}
                      >
                        <ArrowUp className="size-3.5" />
                        {promotePreview.isPending ? 'Promoting...' : 'Promote to stable'}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {previewDeployments.length === 0 ? (
            <EmptyState
              icon={Eye}
              title="No preview deployments"
              description="Preview deployments are created when deploying to a preview environment."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deployment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewDeployments.map((dep) => {
                  const url = resolvePreviewUrl(dep)
                  return (
                    <TableRow key={dep.id}>
                      <TableCell><IdChip id={dep.id} label="Copy deployment id" /></TableCell>
                      <TableCell><StatusBadge status={dep.status} /></TableCell>
                      <TableCell>
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-64 items-center gap-1 truncate font-mono text-xs text-primary hover:underline">
                            {url}
                            <ExternalLink className="size-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell><RelativeTime value={dep.createdAt} className="text-sm text-muted-foreground" /></TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
