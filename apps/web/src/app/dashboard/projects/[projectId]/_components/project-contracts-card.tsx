'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useState } from 'react'
import { useProject, useUpdateProject } from '@/domains/project/hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { FileCheck, Plus, X, Save } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Contract Registry card — the "interfaces" services implement (DI semantics).
 *
 * A mock must implement the same contractRef as the service it replaces; the
 * platform validates the swap at preview time. This is where a project declares
 * its contracts (OpenAPI / proto / json-schema) so mocks can be auto-discovered
 * and swaps validated.
 */
interface ContractEntry {
  contractRef: string
  source: { kind: 'openapi' | 'proto' | 'json-schema'; path: string }
  version?: string
  description?: string
}

export function ProjectContractsCard({ projectId }: { projectId: string }) {
  const { data: projectData, isLoading } = useProject(projectId)
  const updateProject = useUpdateProject()
  const [saving, setSaving] = useState(false)

  const contracts: ContractEntry[] = (() => {
    const settings = (projectData as Record<string, unknown> | undefined)?.settings as { contracts?: Record<string, ContractEntry> } | undefined
    const map = settings?.contracts ?? {}
    return Object.entries(map).map(([contractRef, entry]) => ({
      contractRef,
      source: entry.source ?? { kind: 'openapi', path: '' },
      version: entry.version,
      description: entry.description,
    }))
  })()

  const [edits, setEdits] = useState<ContractEntry[] | null>(null)
  const entries = edits ?? contracts

  const updateEntry = (index: number, partial: Partial<ContractEntry>) => {
    setEdits((prev) => {
      const base = prev ?? contracts
      const next = base.map((e, i) => (i === index ? { ...e, ...partial } : e))
      return next
    })
  }

  const addEntry = () => {
    setEdits((prev) => {
      const base = prev ?? contracts
      return [...base, { contractRef: '', source: { kind: 'openapi', path: '' }, version: '1' }]
    })
  }

  const removeEntry = (index: number) => {
    setEdits((prev) => {
      const base = prev ?? contracts
      return base.filter((_, i) => i !== index)
    })
  }

  const handleSave = async () => {
    const valid = entries.filter((e) => e.contractRef.trim() && e.source.path.trim())
    const map: Record<string, ContractEntry> = {}
    for (const e of valid) {
      map[e.contractRef.trim()] = e
    }
    setSaving(true)
    try {
      const settings = (projectData as Record<string, unknown> | undefined)?.settings ?? {}
      await updateProject.mutateAsync({
        id: projectId,
        settings: { ...settings, contracts: map } as never,
      })
      toast.success('Contract registry updated')
      setEdits(null)
    } catch (err) {
      toast.error('Failed to save contracts', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileCheck className="size-4 text-muted-foreground" /> Contract registry
          </CardTitle>
          <CardDescription className="text-xs">
            The interfaces services implement. A mock must match the replaced service&apos;s contractRef —
            the platform validates the swap at preview time.
          </CardDescription>
        </div>
        <div className="flex gap-1.5">
          {edits !== null ? (
            <>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setEdits(null)}>Cancel</Button>
              <Button size="sm" className="h-7 gap-1 text-[11px]" onClick={() => { void handleSave() }} disabled={saving}>
                <Save className="size-3" /> {saving ? 'Saving…' : 'Save'}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={addEntry}>
              <Plus className="size-3" /> Add contract
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading contracts…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No contracts declared. Add one (e.g. <code className="font-mono">api.oas3</code>) to let mocks
            replace real services by contract.
          </p>
        ) : (
          entries.map((entry, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border bg-background/40 px-3 py-2">
              <Input
                value={entry.contractRef}
                onChange={(e) => { updateEntry(i, { contractRef: e.target.value }) }}
                placeholder="contract ref (e.g. api.oas3)"
                className="h-8 w-44 font-mono"
              />
              <Select
                value={entry.source.kind}
                onValueChange={(v) => { updateEntry(i, { source: { ...entry.source, kind: v as ContractEntry['source']['kind'] } }) }}
              >
                <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openapi">OpenAPI</SelectItem>
                  <SelectItem value="proto">protobuf</SelectItem>
                  <SelectItem value="json-schema">JSON Schema</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={entry.source.path}
                onChange={(e) => { updateEntry(i, { source: { ...entry.source, path: e.target.value } }) }}
                placeholder="spec path (e.g. contracts/api.oas3.yml)"
                className="h-8 flex-1 min-w-40 font-mono"
              />
              <Input
                value={entry.version ?? ''}
                onChange={(e) => { updateEntry(i, { version: e.target.value }) }}
                placeholder="v1"
                className="h-8 w-16 font-mono"
              />
              <Button size="icon" variant="ghost" className="ml-auto size-7 p-0 text-destructive hover:text-destructive" onClick={() => { removeEntry(i) }}>
                <X className="size-3.5" />
              </Button>
            </div>
          ))
        )}
        {entries.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {entries.filter((e) => e.contractRef.trim()).map((e) => (
              <Badge key={e.contractRef} variant="outline" className="font-mono text-[10px]">{e.contractRef}</Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
