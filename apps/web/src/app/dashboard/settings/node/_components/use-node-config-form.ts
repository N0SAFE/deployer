'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import type { MeshNodeRole, MeshRoutingMode, MeshPartitionConsistencyMode } from '@repo/contracts-entities'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import { useMeshUpdateNodeConfig } from '@/domains/mesh/hooks'

export interface NodeConfigFormSeed {
  nodeId: string
  strategy: 'local' | 'remote'
  meshUrls: string[]
  databaseUrl: string
  region: string
  zone: string
  version: string
  roles: string[]
  routingMode: string
  consistencyMode: string
}

/** Form state + save handler for the node configuration editor. */
export function useNodeConfigForm() {
  const update = useMeshUpdateNodeConfig()
  const [open, setOpen] = useState(false)
  const [nodeId, setNodeId] = useState('')
  const [strategy, setStrategy] = useState<'local' | 'remote'>('local')
  const [meshUrls, setMeshUrls] = useState('')
  const [databaseUrl, setDatabaseUrl] = useState('')
  const [region, setRegion] = useState('')
  const [zone, setZone] = useState('')
  const [version, setVersion] = useState('')
  const [roles, setRoles] = useState('')
  const [routingMode, setRoutingMode] = useState('')
  const [consistencyMode, setConsistencyMode] = useState('')

  const begin = (seed: NodeConfigFormSeed) => {
    setNodeId(seed.nodeId)
    setStrategy(seed.strategy)
    setMeshUrls(seed.meshUrls.join('\n'))
    setDatabaseUrl(seed.databaseUrl)
    setRegion(seed.region)
    setZone(seed.zone)
    setVersion(seed.version)
    setRoles(seed.roles.join(', '))
    setRoutingMode(seed.routingMode)
    setConsistencyMode(seed.consistencyMode)
    setOpen(true)
  }

  const save = async () => {
    try {
      await update.mutateAsync({
        nodeId: nodeId.trim() || undefined,
        strategy,
        meshUrlsSnapshot: meshUrls.trim() ? meshUrls.split('\n').map((s) => s.trim()).filter(Boolean) : undefined,
        databaseUrl: databaseUrl.trim() || null,
        region: region.trim() || null,
        zone: zone.trim() || null,
        version: version.trim() || null,
        roles: roles.trim() ? (roles.split(',').map((s) => s.trim()).filter(Boolean) as MeshNodeRole[]) : null,
        routingMode: (routingMode || null) as MeshRoutingMode | null,
        consistencyMode: (consistencyMode || null) as MeshPartitionConsistencyMode | null,
      })
      setOpen(false)
      toast.success('Node configuration saved — it applies on the next service restart')
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown error'
      toast.error(`Failed to update config: ${message}`)
    }
  }

  return {
    open,
    cancel: () => { setOpen(false) },
    begin,
    save,
    saving: update.isPending,
    fields: {
      nodeId: [nodeId, setNodeId],
      strategy: [strategy, setStrategy],
      meshUrls: [meshUrls, setMeshUrls],
      databaseUrl: [databaseUrl, setDatabaseUrl],
      region: [region, setRegion],
      zone: [zone, setZone],
      version: [version, setVersion],
      roles: [roles, setRoles],
      routingMode: [routingMode, setRoutingMode],
      consistencyMode: [consistencyMode, setConsistencyMode],
    },
  } as const
}
