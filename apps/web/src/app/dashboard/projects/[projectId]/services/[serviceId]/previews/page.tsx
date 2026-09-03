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
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Siren, Eye, ExternalLink, Globe, Timer, Webhook, ArrowUp } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate, shortId, statusBadgeVariant } from '../../../_utils/helpers'
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

function daysLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null
  const diff = new Date(expiresAt).getTime() - Date.now()
  return Math.ceil(diff / (24 * 60 * 60 * 1000))
}

export default function DashboardServicePreviewsPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId ?? ''
  const serviceId = params.serviceId ?? ''

  const { data: serviceData, isLoading: serviceLoading } = useService(serviceId)
  const { data: serviceDomainsData } = useServiceDomains(serviceId)
  const { data: deploymentsData } = useDeploymentList({
    query: { filter: { projectId: { operator: 'eq' as const, value: projectId } }, limit: 50, offset: 0 },
  })
  const { data: previewsData } = useServicePreviews(serviceId)

  // Primary domain mapping (used as the preview base when no explicit URL is stored).
  const primaryDomain = useMemo(() => {
    const mappings = (serviceDomainsData ?? []) as Array<{ fullUrl: string; subdomain: string | null; isPrimary: boolean }>
    return mappings.find((m) => m.isPrimary) ?? mappings[0] ?? null
  }, [serviceDomainsData])

  const previewDeployments = useMemo(() => {
    if (!deploymentsData?.data) return []
    return deploymentsData.data.filter((d: any) => (d.environment === 'preview' || d.type === 'preview') && (d.serviceId === serviceId || d.service_id === serviceId))
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

  const resolvePreviewUrl = (dep: any): string | null => {
    // 1. Explicit URL stored on the deployment.
    const stored = dep.previewUrl ?? dep.url ?? dep.metadata?.resolvedUrl ?? dep.metadata?.previewUrl
    if (typeof stored === 'string' && stored) return stored
    // 2. Compute from branch/PR against the service's primary domain.
    if (!previewBase) return null
    const branch = dep.metadata?.branchName ?? dep.branch ?? null
    const prNumber = typeof dep.metadata?.prNumber === 'number' ? dep.metadata.prNumber : null
    const host = previewBase.replace(/^https?:\/\//, '')
    const pattern = defaultPreviewPattern(host)
    return `https://${resolvePreviewUrlPattern(pattern, { serviceId, branchName: branch, prNumber })}`
  }

  if (serviceLoading) return <div className="space-y-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-48 w-full rounded-xl" /></div>
  if (!serviceData) return <Alert variant="destructive"><Siren className="size-4" /><AlertTitle>Not found</AlertTitle><AlertDescription>Service not found.</AlertDescription></Alert>

  const service = serviceData as any

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Preview Environments</CardTitle>
          <CardDescription>Branch-based preview deployments for <strong>{service.name ?? serviceId}</strong>.</CardDescription>
        </CardHeader>
        <CardContent>
          {previewBase && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
              <Globe className="size-4 text-primary" />
              <span className="text-muted-foreground">Previews resolve from your primary domain:</span>
              <code className="font-mono font-medium text-foreground">{previewBase}</code>
            </div>
          )}

          {/* Live preview environments (preview_environments read model) */}
          {previewEnvironments.length > 0 && (
            <div className="mb-6 space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Provisioned previews</p>
              {previewEnvironments.map((p) => {
                const expired = p.expiresAt ? new Date(p.expiresAt).getTime() < Date.now() : false
                const remaining = daysLeft(p.expiresAt)
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
                    <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                      {p.metadata?.branchName && <span>branch: {p.metadata.branchName}</span>}
                      {p.metadata?.accessCount != null && <span>{p.metadata.accessCount} visits</span>}
                      {remaining != null && (
                        <span className="inline-flex items-center gap-1">
                          <Timer className="size-3" />
                          {expired ? 'expired' : `${remaining}d left`}
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
                        onClick={() => handlePromote(p.fullDomain, p.subdomain)}
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
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Eye className="mb-4 size-12 text-muted-foreground/40" />
              <p className="text-lg font-medium">No preview deployments</p>
              <p className="text-sm text-muted-foreground">
                Preview deployments are created when deploying to a preview environment.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewDeployments.map((dep: any, i: number) => {
                  const url = resolvePreviewUrl(dep)
                  return (
                    <TableRow key={dep.id ?? i}>
                      <TableCell className="font-mono text-xs">{shortId(dep.id)}</TableCell>
                      <TableCell><Badge variant={statusBadgeVariant(dep.status ?? dep.state)}>{dep.status ?? dep.state ?? 'unknown'}</Badge></TableCell>
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
                      <TableCell className="text-muted-foreground text-xs">{formatDate(dep.createdAt ?? dep.created_at)}</TableCell>
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
