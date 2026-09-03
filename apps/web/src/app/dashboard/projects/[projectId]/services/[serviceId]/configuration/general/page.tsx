'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useService, useUpdateService } from '@/domains/service/hooks'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Textarea } from '@repo/ui/components/shadcn/textarea'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Siren, Save, Hash, Boxes, CalendarClock } from 'lucide-react'
import { toast } from 'sonner'
import { ServiceConfigSubNav } from '../../_components/service-config-subnav'
import { AutocompleteField } from '@/app/dashboard/projects/_components/steps/autocomplete-field'
import { SERVICE_TYPES } from '@repo/contracts-common'

interface ServiceFields {
  id: string
  name?: string
  description?: string | null
  type?: string
  port?: number | null
  isActive?: boolean
  resourceLimits?: { memory?: string; cpu?: string; storage?: string }
  deploymentRetention?: { maxSuccessfulDeployments?: number; keepArtifacts?: boolean; autoCleanup?: boolean }
}

export default function DashboardServiceConfigurationGeneralPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId
  const serviceId = params.serviceId

  const { data: serviceData, isLoading: serviceLoading } = useService(serviceId)
  const updateService = useUpdateService()
  const service = (serviceData ?? null) as ServiceFields | null

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState('application')
  const [port, setPort] = useState('')
  const [memory, setMemory] = useState('')
  const [cpu, setCpu] = useState('')
  const [storage, setStorage] = useState('')
  const [keepArtifacts, setKeepArtifacts] = useState(true)
  const [autoCleanup, setAutoCleanup] = useState(true)
  const [maxDeployments, setMaxDeployments] = useState('5')
  const [loaded, setLoaded] = useState(false)

  // Seed once when the service loads (useEffect — not render-time setState,
  // which would break re-seeding when React re-renders with fresh data).
  useEffect(() => {
    if (!loaded && service) {
      setName(service.name ?? '')
      setDescription(service.description ?? '')
      setType(service.type ?? 'application')
      setPort(service.port != null ? String(service.port) : '')
      setMemory(service.resourceLimits?.memory ?? '')
      setCpu(service.resourceLimits?.cpu ?? '')
      setStorage(service.resourceLimits?.storage ?? '')
      setKeepArtifacts(service.deploymentRetention?.keepArtifacts ?? true)
      setAutoCleanup(service.deploymentRetention?.autoCleanup ?? true)
      setMaxDeployments(String(service.deploymentRetention?.maxSuccessfulDeployments ?? 5))
      setLoaded(true)
    }
  }, [loaded, service])

  if (serviceLoading) return <div className="space-y-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-48 w-full" /></div>
  if (!service) return <Alert variant="destructive"><Siren className="size-4" /><AlertTitle>Not found</AlertTitle><AlertDescription>Service not found.</AlertDescription></Alert>

  const handleSave = async () => {
    try {
      await updateService.mutateAsync({
        id: serviceId,
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        type: (type.trim() || undefined) as never,
        port: port.trim() ? Number(port) : undefined,
        resourceLimits: {
          memory: memory.trim() || undefined,
          cpu: cpu.trim() || undefined,
          storage: storage.trim() || undefined,
        },
        deploymentRetention: {
          maxSuccessfulDeployments: maxDeployments.trim() ? Number(maxDeployments) : 5,
          keepArtifacts,
          autoCleanup,
        },
      })
      toast.success('Service configuration saved')
    } catch (err) {
      toast.error('Failed to save', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  return (
    <div className="space-y-6">
      <ServiceConfigSubNav projectId={projectId} serviceId={serviceId} active="general" />

      {/* ── Identity ── */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="flex items-center gap-2 text-sm"><Hash className="size-4 text-muted-foreground" /> Identity</CardTitle><CardDescription className="text-xs">Name, description and service type.</CardDescription></div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => { setName(e.target.value) }} placeholder="my-service" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => { setDescription(e.target.value) }} placeholder="What does this service do?" className="min-h-20 resize-y" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <AutocompleteField
                value={type}
                onChange={setType}
                options={SERVICE_TYPES}
                placeholder="application"
              />
              <p className="text-xs text-muted-foreground">How this service is deployed (application / compose / sub-services / …).</p>
            </div>
            <div className="space-y-1.5">
              <Label>Container port</Label>
              <Input type="number" value={port} onChange={(e) => { setPort(e.target.value) }} placeholder="3000" />
            </div>
          </div>
          <Button size="sm" onClick={() => { void handleSave() }} disabled={updateService.isPending}>
            <Save className="mr-1.5 size-3.5" /> {updateService.isPending ? 'Saving…' : 'Save'}
          </Button>
        </CardContent>
      </Card>

      {/* ── Resources ── */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Boxes className="size-4 text-muted-foreground" /> Resources</CardTitle><CardDescription className="text-xs">CPU, memory and storage limits.</CardDescription></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Memory</Label>
              <AutocompleteField value={memory} onChange={setMemory} options={['128m', '256m', '512m', '1g', '2g', '4g', '8g']} placeholder="No limit" />
            </div>
            <div className="space-y-1.5">
              <Label>CPU</Label>
              <AutocompleteField value={cpu} onChange={setCpu} options={['0.25', '0.5', '1', '2', '4', '8']} placeholder="No limit" />
            </div>
            <div className="space-y-1.5">
              <Label>Storage</Label>
              <AutocompleteField value={storage} onChange={setStorage} options={['1g', '5g', '10g', '20g', '50g']} placeholder="No limit" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Retention ── */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><CalendarClock className="size-4 text-muted-foreground" /> Deployment retention</CardTitle><CardDescription className="text-xs">Deployments to keep and auto-cleanup.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Max successful deployments</Label>
              <AutocompleteField value={maxDeployments} onChange={setMaxDeployments} options={['1', '3', '5', '10', '20', '50']} placeholder="5" />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Keep artifacts</p>
                <p className="text-xs text-muted-foreground">Keep Docker images + build artifacts.</p>
              </div>
              <Switch checked={keepArtifacts} onCheckedChange={setKeepArtifacts} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Auto cleanup</p>
                <p className="text-xs text-muted-foreground">Automatically clean old deployments.</p>
              </div>
              <Switch checked={autoCleanup} onCheckedChange={setAutoCleanup} />
            </div>
          </div>
          <Button size="sm" onClick={() => { void handleSave() }} disabled={updateService.isPending}>
            <Save className="mr-1.5 size-3.5" /> {updateService.isPending ? 'Saving…' : 'Save'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
