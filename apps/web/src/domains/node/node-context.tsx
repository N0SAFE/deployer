'use client'

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import { useMeshLocalNode } from '@/domains/mesh/hooks'

/**
 * Node context — provides the currently selected node scope for the dashboard.
 *
 * - `nodeId` is `null` when viewing at mesh level (global scope).
 * - `nodeId` is a string when viewing a specific node.
 * - `setNodeId(null)` returns to mesh-level view.
 *
 * Use `useNodeScope()` in any component that needs to know whether it's
 * rendering in mesh-wide or per-node context.
 */

interface NodeScope {
  /** Currently selected node ID, or null for mesh-wide view */
  nodeId: string | null
  /** Set the active node scope. Pass null to return to mesh-wide. */
  setNodeId: (id: string | null) => void
  /** Whether a specific node is selected */
  isNodeSelected: boolean
  /** The local node ID (from mesh identity), if known */
  localNodeId: string | undefined
}

const NodeScopeContext = createContext<NodeScope | null>(null)

export function NodeScopeProvider({ children }: { children: ReactNode }) {
  const [nodeId, setNodeId] = useState<string | null>(null)
  const { data: localNode } = useMeshLocalNode()
  const localNodeId = localNode?.nodeId

  const isNodeSelected = nodeId !== null

  const value = useMemo<NodeScope>(
    () => ({ nodeId, setNodeId, isNodeSelected, localNodeId }),
    [nodeId, setNodeId, isNodeSelected, localNodeId],
  )

  return <NodeScopeContext.Provider value={value}>{children}</NodeScopeContext.Provider>
}

/**
 * Hook to access the current node scope.
 *
 * Returns `{ nodeId, setNodeId, isNodeSelected, localNodeId }`.
 *
 * @example
 * ```tsx
 * // Global (mesh) view
 * const { nodeId, setNodeId } = useNodeScope()
 *
 * // Switch to a specific node
 * setNodeId('abc-123')
 *
 * // Return to mesh-wide
 * setNodeId(null)
 * ```
 */
export function useNodeScope(): NodeScope {
  const ctx = useContext(NodeScopeContext)
  if (!ctx) {
    throw new Error('useNodeScope must be used within a <NodeScopeProvider>')
  }
  return ctx
}
