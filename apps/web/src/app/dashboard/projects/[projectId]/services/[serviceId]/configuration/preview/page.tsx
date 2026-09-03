'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useService, useUpdateService } from '@/domains/service/hooks'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Separator } from '@repo/ui/components/shadcn/separator'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Siren, Save, Rocket, Link2, FileCheck, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { ServiceConfigSubNav } from '../../_components/service-config-subnav'
import { ENV_NAMES, type EnvName } from '@repo/contracts-common'

/**
 * Service Configuration → Preview
 *
 * POC config surface for the self-deploy / preview-linked-services system:
 *  1. CONTRACT — the contract this service implements (DI semantics). A mock
 *     must match the replaced service's contractRef.
 *  2. BACKEND RESOLUTION — how a preview of THIS service resolves its backend
 *     dependency: linked-preview (recurse) | fixed (reuse staging) |
 *     mock (replace with a mock) | derive (from input).
 *  3. LINKED SERVICES — services to spin up alongside this preview, each with
 *     its own resolution override.
 *  4. SUBDOMAIN TEMPLATE — preview URL pattern.
 *
 * This is CONFIGURATION ONLY — the deployment lifecycle that consumes it comes
 * in a later phase.
 */
export default function DashboardServiceConfigurationPreviewPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId ?? ''
  const serviceId = params.serviceId ?? ''

  const { data: serviceData, isLoading: serviceLoading } = useService(serviceId)
  const updateService = useUpdateService()

  // ── Local state (loaded once from the service) ──
  const [contractRef, setContractRef] = useState('')
  const [compatibility, setCompatibility] = useState<'http' | 'grpc' | 'events'>('http')
  const [resolutionMode, setResolutionMode] = useState<'linked-preview' | 'fixed' | 'mock' | 'derive'>('linked-preview')
  const [fixedTarget, setFixedTarget] = useState<EnvName>('staging')
  const [mockRef, setMockRef] = useState('')
  const [deriveKey, setDeriveKey] = useState('pullRequestNumber')
  const [deriveFallback, setDeriveFallback] = useState<EnvName>('staging')
  const [subdomainTemplate, setSubdomainTemplate] = useState('{branch}-{service}')
  const [linkedServices, setLinkedServices] = useState<Array<{
    serviceId: string
    mode: 'inherit' | 'mock' | 'fixed'
    mockRef?: string
    fixedEnvironment?: EnvName
  }>>([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  // ── Load existing config once ──
  useEffect(() => {
    if (loaded || !serviceData) return
    const s = serviceData as Record<string, unknown>
    const contract = (s.implementsContract ?? null) as { contractRef?: string; compatibility?: 'http' | 'grpc' | 'events' } | null
    if (contract?.contractRef) {
      setContractRef(contract.contractRef)
      setCompatibility(contract.compatibility ?? 'http')
    }
    const preview = (s.preview ?? null) as {
      backendResolution?: { mode?: string; targetEnvironment?: EnvName; mockRef?: string; fromInputKey?: string; fallbackEnvironment?: EnvName }
      linkedServices?: Array<{ serviceId: string; mode?: string; mockRef?: string; fixedEnvironment?: EnvName }>
      subdomainTemplate?: string
    } | null
    if (preview?.backendResolution?.mode) {
      const mode = preview.backendResolution.mode
      if (mode === 'linked-preview' || mode === 'fixed' || mode === 'mock' || mode === 'derive') {
        setResolutionMode(mode)
      }
      if (mode === 'fixed' && preview.backendResolution.targetEnvironment) {
        setFixedTarget(preview.backendResolution.targetEnvironment)
      }
      if (mode === 'mock' && preview.backendResolution.mockRef) {
        setMockRef(preview.backendResolution.mockRef)
      }
      if (mode === 'derive') {
        if (preview.backendResolution.fromInputKey) setDeriveKey(preview.backendResolution.fromInputKey)
        if (preview.backendResolution.fallbackEnvironment) setDeriveFallback(preview.backendResolution.fallbackEnvironment)
      }
    }
    if (preview?.subdomainTemplate) setSubdomainTemplate(preview.subdomainTemplate)
    if (preview?.linkedServices?.length) {
      setLinkedServices(preview.linkedServices.map((l) => ({
        serviceId: l.serviceId,
        mode: (l.mode as 'inherit' | 'mock' | 'fixed' | undefined) ?? 'inherit',
        mockRef: l.mockRef,
        fixedEnvironment: l.fixedEnvironment,
      })))
    }
    setLoaded(true)
  }, [loaded, serviceData])

  if (serviceLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  if (!serviceData) {
    return (
      <Alert variant="destructive">
        <Siren className="size-4" />
        <AlertTitle>Service not found</AlertTitle>
        <AlertDescription>This service does not exist.</AlertDescription>
      </Alert>
    )
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateService.mutateAsync({
        id: serviceId,
        // Only set the contract when a ref is given (else clear it).
        implementsContract: contractRef.trim()
          ? { contractRef: contractRef.trim(), compatibility }
          : null,
        preview: {
          backendResolution: resolutionMode === 'linked-preview'
            ? { mode: 'linked-preview' as const }
            : resolutionMode === 'fixed'
              ? { mode: 'fixed' as const, targetEnvironment: fixedTarget }
              : resolutionMode === 'mock'
                ? { mode: 'mock' as const, mockRef }
                : { mode: 'derive' as const, fromInputKey: deriveKey, fallbackEnvironment: deriveFallback },
          linkedServices: linkedServices.map((l) => ({
            serviceId: l.serviceId,
            mode: l.mode,
            ...(l.mode === 'mock' && l.mockRef ? { mockRef: l.mockRef } : {}),
            ...(l.mode === 'fixed' && l.fixedEnvironment ? { fixedEnvironment: l.fixedEnvironment } : {}),
          })),
          subdomainTemplate,
        },
      })
      toast.success('Preview configuration saved')
    } catch (err) {
      toast.error('Failed to save', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <ServiceConfigSubNav projectId={projectId} serviceId={serviceId} active="preview" />

      {/* ── 1. Contract ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm"><FileCheck className="size-4 text-muted-foreground" /> Contract</CardTitle>
            <CardDescription className="text-xs">
              The contract this service implements (DI semantics). A mock replacing this service must
              declare the same contractRef — the platform validates the swap.
            </CardDescription>
          </div>
          {contractRef.trim() ? <Badge variant="outline" className="font-mono">{contractRef}</Badge> : null}
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="contractRef">Contract ref</Label>
            <Input
              id="contractRef"
              value={contractRef}
              onChange={(e) => setContractRef(e.target.value)}
              placeholder="api.oas3"
              className="font-mono"
            />
            <p className="text-[11px] text-muted-foreground">e.g. api.oas3, checkout.payment, user.events</p>
          </div>
          <div className="space-y-1.5">
            <Label>Compatibility</Label>
            <Select value={compatibility} onValueChange={(v) => setCompatibility(v as 'http' | 'grpc' | 'events')}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="http">HTTP</SelectItem>
                <SelectItem value="grpc">gRPC</SelectItem>
                <SelectItem value="events">Events</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── 2. Backend resolution ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Rocket className="size-4 text-muted-foreground" /> Preview backend resolution</CardTitle>
          <CardDescription className="text-xs">
            How a preview of THIS service resolves its backend dependency.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Resolution mode</Label>
            <Select value={resolutionMode} onValueChange={(v) => setResolutionMode(v as typeof resolutionMode)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="linked-preview">Linked preview — spin up the dependency's own preview (recurse)</SelectItem>
                <SelectItem value="fixed">Fixed — reuse a shared environment (e.g. staging)</SelectItem>
                <SelectItem value="mock">Mock — replace with a mock implementing the same contract</SelectItem>
                <SelectItem value="derive">Derive — resolve environment from an input key, fallback</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {resolutionMode === 'fixed' && (
            <div className="space-y-1.5">
              <Label>Target environment</Label>
              <Select value={fixedTarget} onValueChange={(v) => setFixedTarget(v as EnvName)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[...ENV_NAMES, 'staging'].filter((v, i, a) => a.indexOf(v) === i).map((env) => (
                    <SelectItem key={env} value={env} className="capitalize">{env}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {resolutionMode === 'mock' && (
            <div className="space-y-1.5">
              <Label htmlFor="mockRef">Mock service ref</Label>
              <Input
                id="mockRef"
                value={mockRef}
                onChange={(e) => setMockRef(e.target.value)}
                placeholder="api-stub"
                className="font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                Service id or name of the mock (spec-driven or DI-style code mock) implementing the same contract.
              </p>
            </div>
          )}

          {resolutionMode === 'derive' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="deriveKey">Input key</Label>
                <Input
                  id="deriveKey"
                  value={deriveKey}
                  onChange={(e) => setDeriveKey(e.target.value)}
                  placeholder="pullRequestNumber"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Fallback environment</Label>
                <Select value={deriveFallback} onValueChange={(v) => setDeriveFallback(v as EnvName)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[...ENV_NAMES, 'staging'].filter((v, i, a) => a.indexOf(v) === i).map((env) => (
                      <SelectItem key={env} value={env} className="capitalize">{env}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 3. Linked services ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm"><Link2 className="size-4 text-muted-foreground" /> Linked services</CardTitle>
            <CardDescription className="text-xs">
              Services to spin up alongside this preview (Railway Focused-PR style). Each resolves independently.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => setLinkedServices((prev) => [...prev, { serviceId: '', mode: 'inherit' }])}>
            <Plus className="size-3" /> Add linked service
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {linkedServices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No linked services. Add one to include a sibling service in this preview.</p>
          ) : (
            linkedServices.map((ls, idx) => (
              <div key={idx} className="flex flex-wrap items-center gap-2 rounded-md border bg-background/40 px-3 py-2">
                <Input
                  value={ls.serviceId}
                  onChange={(e) => {
                    setLinkedServices((prev) => prev.map((item, i) => (i === idx ? { ...item, serviceId: e.target.value } : item)))
                  }}
                  placeholder="service id or name"
                  className="h-8 w-52 font-mono"
                />
                <Select
                  value={ls.mode}
                  onValueChange={(v) => {
                    setLinkedServices((prev) => prev.map((item, i) => (i === idx ? { ...item, mode: v as 'inherit' | 'mock' | 'fixed' } : item)))
                  }}
                >
                  <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">inherit</SelectItem>
                    <SelectItem value="mock">mock</SelectItem>
                    <SelectItem value="fixed">fixed</SelectItem>
                  </SelectContent>
                </Select>
                {ls.mode === 'mock' && (
                  <Input
                    value={ls.mockRef ?? ''}
                    onChange={(e) => {
                      setLinkedServices((prev) => prev.map((item, i) => (i === idx ? { ...item, mockRef: e.target.value } : item)))
                    }}
                    placeholder="mock ref"
                    className="h-8 w-44 font-mono"
                  />
                )}
                {ls.mode === 'fixed' && (
                  <Select
                    value={ls.fixedEnvironment ?? 'staging'}
                    onValueChange={(v) => {
                      setLinkedServices((prev) => prev.map((item, i) => (i === idx ? { ...item, fixedEnvironment: v as EnvName } : item)))
                    }}
                  >
                    <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[...ENV_NAMES, 'staging'].filter((v, i, a) => a.indexOf(v) === i).map((env) => (
                        <SelectItem key={env} value={env} className="capitalize">{env}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-auto size-7 p-0 text-destructive hover:text-destructive"
                  onClick={() => setLinkedServices((prev) => prev.filter((_, i) => i !== idx))}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ── 4. Subdomain template ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Link2 className="size-4 text-muted-foreground" /> Preview URL</CardTitle>
          <CardDescription className="text-xs">Subdomain template for this preview (GitLab review-app style).</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value={subdomainTemplate}
            onChange={(e) => setSubdomainTemplate(e.target.value)}
            placeholder="{branch}-{service}"
            className="font-mono"
          />
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button onClick={() => { void handleSave() }} disabled={saving}>
          <Save className="mr-1.5 size-4" />
          {saving ? 'Saving…' : 'Save preview configuration'}
        </Button>
      </div>
    </div>
  )
}
