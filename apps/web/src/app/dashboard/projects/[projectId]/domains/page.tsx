'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Globe, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import { EmptyState, PageSkeleton } from '@/components/dashboard'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import { useProject } from '@/domains/project/hooks'
import { useAddProjectDomain, useProjectDomains, useRemoveProjectDomain } from '@/domains/domain/hooks'
import { ConfirmDialog } from '../../_components/ConfirmDialog'
import { InlineError } from '../../_components/workload/WorkloadStates'
import { AddDomainDialog, type AddDomainValues } from '../../_components/domains/AddDomainDialog'
import { ProjectDomainRow, type ProjectDomain } from '../../_components/domains/ProjectDomainRow'

const messageFor = (err: unknown, fallback: string): string => (isDefinedORPCError(err) ? getErrorMessage(err, fallback) : fallback)

export default function ProjectDomainsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: project } = useProject(projectId)
  const domainsQuery = useProjectDomains(projectId)
  const addDomain = useAddProjectDomain()
  const removeDomain = useRemoveProjectDomain()

  const [addOpen, setAddOpen] = useState(false)
  const [removing, setRemoving] = useState<ProjectDomain | null>(null)
  const domains = useMemo(() => domainsQuery.data ?? [], [domainsQuery.data])

  if (domainsQuery.isLoading) return <PageSkeleton blocks={1} withStrip={false} label="Loading domains" />
  if (domainsQuery.error) {
    return <InlineError title="Could not load domains" error={domainsQuery.error} onRetry={() => { void domainsQuery.refetch() }} />
  }

  const add = async (values: AddDomainValues) => {
    try {
      await addDomain.mutateAsync({ params: { projectId }, body: values })
      toast.success('Domain added')
      setAddOpen(false)
    } catch (err) {
      toast.error(messageFor(err, 'Failed to add domain'))
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Domains</CardTitle>
            <CardDescription>Domains registered for {project?.name ?? 'this project'}. Services bind to them under Service → Configuration → Network &amp; domains; reachability is checked automatically.</CardDescription>
          </div>
          <Button size="sm" onClick={() => { setAddOpen(true) }}><Plus className="mr-2 size-4" />Add domain</Button>
        </CardHeader>
        <CardContent>
          {domains.length === 0 ? (
            <EmptyState
              icon={Globe}
              title="No domains yet"
              description="Add a domain you own, verify it, then bind it to a service from the service's Network & domains page."
              action={{ label: 'Add domain', onClick: () => { setAddOpen(true) } }}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Verification</TableHead>
                    <TableHead>Reachability</TableHead>
                    <TableHead>Primary</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="w-28 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domains.map((d) => (<ProjectDomainRow key={d.id} domain={d} onRemove={setRemoving} />))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {addOpen ? <AddDomainDialog pending={addDomain.isPending} onAdd={add} onClose={() => { setAddOpen(false) }} /> : null}
      {removing ? (
        <ConfirmDialog
          title="Remove domain"
          objectName={removing.domain}
          consequence="is unlinked from this project; services bound to it stop being served on it."
          confirmLabel="Remove domain"
          pending={removeDomain.isPending}
          onClose={() => { setRemoving(null) }}
          onConfirm={() => {
            void removeDomain
              .mutateAsync({ params: { projectId, domainId: removing.id } })
              .then(() => { toast.success('Domain removed'); setRemoving(null) })
              .catch((err: unknown) => { toast.error(messageFor(err, 'Failed to remove domain')) })
          }}
        />
      ) : null}
    </>
  )
}
