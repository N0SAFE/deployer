'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Globe, Plus, Siren } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@deployer/ui/components/shadcn/alert'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import { EmptyState, PageErrorState, PageHeader } from '@/components/dashboard'
import { useProjectDomains, useRemoveProjectDomain, useVerifyProjectDomain } from '@/domains/domain/hooks'
import { useProjectList } from '@/domains/project/hooks'
import { useCheckDomainGate } from '@/domains/reachability/hooks'
import { AuthDashboardNetworkIngress, AuthDashboardProjects } from '@/routes'
import { isDefinedORPCError, getErrorMessage, UNKNOWN_ORPC_ERROR_MESSAGE } from '@/lib/orpc/typed-errors'
import { AddDomainDialog } from './_components/add-domain-dialog'
import { DnsCheckDialog, RemoveDomainDialog } from './_components/dialogs'
import { DomainsTable } from './_components/domains-table'
import type { DomainRow, ReachabilityResult } from './_components/domain-types'
import { useDomainReachability } from './_components/use-domain-reachability'

function errorDescription(err: unknown, fallback: string): string {
  return isDefinedORPCError(err) ? getErrorMessage(err, fallback) : UNKNOWN_ORPC_ERROR_MESSAGE
}

/**
 * Domains — the custom domains a project is served on. Ownership is proven by a
 * DNS record; reachability says whether the name actually lands on this stack.
 */
export default function NetworkDomainsPage() {
  const router = useRouter()
  const { data: projectsData, isLoading: projectsLoading, error: projectsError, refetch: refetchProjects } = useProjectList({
    query: { limit: 100, offset: 0 },
  })
  const projects = useMemo(
    () => (projectsData?.data ?? []).map((p) => ({ id: p.id, name: p.name })),
    [projectsData],
  )
  const [chosenProjectId, setChosenProjectId] = useState('')
  // Default to the first project; an explicit choice wins while it still exists.
  const projectId = projects.some((p) => p.id === chosenProjectId) ? chosenProjectId : (projects[0]?.id ?? '')

  const { data: domainsData, isLoading, error, refetch } = useProjectDomains(projectId)
  const domains = useMemo<DomainRow[]>(() => (domainsData ?? []) as DomainRow[], [domainsData])
  const { data: gate } = useCheckDomainGate()
  const verify = useVerifyProjectDomain()
  const remove = useRemoveProjectDomain()
  const reach = useDomainReachability(domains)

  const [addOpen, setAddOpen] = useState(false)
  const [toRemove, setToRemove] = useState<DomainRow | null>(null)
  const [dnsCheck, setDnsCheck] = useState<ReachabilityResult | null>(null)

  const gateBlocked = gate?.allowed === false

  const handleVerify = async (row: DomainRow) => {
    try {
      const result = (await verify.mutateAsync({ params: { projectId, domainId: row.id }, body: {} })) as unknown as { status: string }
      if (result.status === 'verified') toast.success(`${row.domain} verified`)
      else toast.info('Not verified yet', { description: 'The DNS record may still be propagating — try again in a few minutes.' })
      await refetch()
    } catch (err) {
      toast.error('Verification failed', { description: errorDescription(err, 'The DNS record was not found.') })
    }
  }

  const handleInspect = async (row: DomainRow) => {
    const result = await reach.run(row.domain, row.id)
    if (result === null) toast.error('The DNS check failed', { description: 'The check could not run. Try again.' })
    else setDnsCheck(result)
  }

  const handleRemove = async () => {
    if (toRemove === null) return
    try {
      await remove.mutateAsync({ params: { projectId, domainId: toRemove.id } })
      toast.success(`${toRemove.domain} removed`)
      setToRemove(null)
    } catch (err) {
      toast.error('Could not remove the domain', { description: errorDescription(err, 'Unknown error') })
    }
  }

  const header = (
    <PageHeader
      eyebrow="Network"
      title="Domains"
      description="The custom domains a project is served on. Add one, prove you own it with a DNS record, and make sure it points at this stack."
      actions={
        <Button size="sm" onClick={() => { setAddOpen(true) }} disabled={gateBlocked || projectId === ''}>
          <Plus className="size-4" />Add domain
        </Button>
      }
    />
  )

  if (projectsLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading domains">
        <Skeleton className="h-16 w-full max-w-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }
  if (projectsError !== null) {
    return <PageErrorState title="Failed to load projects" message={errorDescription(projectsError, 'Projects could not be read.')} onRetry={() => void refetchProjects()} />
  }
  if (projects.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={Building2}
          title="No projects yet"
          description="Domains belong to a project — create a project first, then add its domains here."
          action={{ label: 'Create a project', onClick: () => { router.push(AuthDashboardProjects()) } }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="domains-project" className="text-sm text-muted-foreground">Project</Label>
        <Select value={projectId} onValueChange={setChosenProjectId}>
          <SelectTrigger id="domains-project" className="w-64 max-w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {gateBlocked ? (
        <Alert variant="destructive">
          <Siren className="size-4" />
          <AlertTitle>Domains cannot be added yet</AlertTitle>
          <AlertDescription>
            {gate.reason ?? 'The public edge is not ready.'} Custom domains are served on the public lane — set it up in{' '}
            <AuthDashboardNetworkIngress.Link className="font-medium underline">Network → Ingress &amp; edge</AuthDashboardNetworkIngress.Link>.
          </AlertDescription>
        </Alert>
      ) : null}

      {isLoading ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : error !== null ? (
        <PageErrorState title="Failed to load domains" message={errorDescription(error, 'The domain list could not be read.')} onRetry={() => void refetch()} />
      ) : domains.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No domains yet — add one"
          description="A domain lets this project be reached on your own name instead of a generated address."
          action={gateBlocked ? undefined : { label: 'Add domain', onClick: () => { setAddOpen(true) } }}
        />
      ) : (
        <DomainsTable
          domains={domains}
          reachability={reach.states}
          verifyPending={verify.isPending}
          checkPending={reach.isChecking}
          onVerify={(row) => void handleVerify(row)}
          onInspect={(row) => void handleInspect(row)}
          onRecheck={(row) => void reach.run(row.domain, row.id)}
          onRemove={setToRemove}
        />
      )}

      <AddDomainDialog open={addOpen} projectId={projectId} onOpenChange={setAddOpen} />
      <RemoveDomainDialog
        domain={toRemove?.domain ?? null}
        pending={remove.isPending}
        onCancel={() => { setToRemove(null) }}
        onConfirm={() => void handleRemove()}
      />
      <DnsCheckDialog result={dnsCheck} onClose={() => { setDnsCheck(null) }} />
    </div>
  )
}
