'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useService, useUpdateService } from '@/domains/service/hooks'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Textarea } from '@deployer/ui/components/shadcn/textarea'
import { Switch } from '@deployer/ui/components/shadcn/switch'
import { Save, Hash, Boxes, CalendarClock } from 'lucide-react'
import { toast } from 'sonner'
import { ServiceConfigSubNav } from '../../_components/service-config-subnav'
import { AutocompleteField } from '@/app/dashboard/projects/_components/steps/autocomplete-field'
import { SERVICE_TYPES } from '@deployer/contracts-common'
import { PageSkeleton } from '@/components/dashboard'
import { InlineError } from '@/app/dashboard/projects/_components/workload/WorkloadStates'

type ServiceData = NonNullable<ReturnType<typeof useService>['data']>

export default function DashboardServiceConfigurationGeneralPage() {
  const { projectId, serviceId } = useParams<{ projectId: string; serviceId: string }>()
  const query = useService(serviceId)

  if (query.isLoading) return <PageSkeleton blocks={3} withStrip={false} label="Loading service configuration" />
  if (query.error) return <InlineError title="Could not load the service" error={query.error} onRetry={() => { void query.refetch() }} />
  if (!query.data) return <InlineError title="Service not found" error={new Error('This service does not exist or was deleted.')} />
  // Keyed so the form seeds once per service; a later refetch never overwrites what is being typed.
  return <GeneralForm key={query.data.id} projectId={projectId} serviceId={serviceId} service={query.data} />
}

function GeneralForm({ projectId, serviceId, service }: { projectId: string; serviceId: string; service: ServiceData }) {
  const updateService = useUpdateService()

  const [name, setName] = useState(service.name)
  const [description, setDescription] = useState(service.description ?? '')
  const [type, setType] = useState<string>(service.type)
  const [port, setPort] = useState(service.port === null ? '' : String(service.port))
  const [memory, setMemory] = useState(service.resourceLimits?.memory ?? '')
  const [cpu, setCpu] = useState(service.resourceLimits?.cpu ?? '')
  const [storage, setStorage] = useState(service.resourceLimits?.storage ?? '')
  // `deploymentRetention` is nullable and its flags optional, so "unset" is a
  // real state. Defaulting to `true` would write an affirmative value the user
  // never chose, so unset shows as off.
  const [keepArtifacts, setKeepArtifacts] = useState(service.deploymentRetention?.keepArtifacts ?? false)
  const [autoCleanup, setAutoCleanup] = useState(service.deploymentRetention?.autoCleanup ?? false)
  const [maxDeployments, setMaxDeployments] = useState(String(service.deploymentRetention?.maxSuccessfulDeployments ?? 5))

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
