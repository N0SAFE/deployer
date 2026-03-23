import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type NodeProps,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

type FlowStep = {
  title: string
  whatHappens: string
  highlightedNodes: string[]
  highlightedEdges: string[]
  events: string[]
}

type MeshNodeData = {
  label: string
  subtitle: string
  active?: boolean
}

type Scenario = {
  id: string
  title: string
  goal: string
  decentralizationNote: string
  nodes: Node<MeshNodeData>[]
  edges: Edge[]
  steps: FlowStep[]
}

type LinkMetric = {
  latencyMs: number
  throughputMbps: number
  weight: number
}

type MeshRuleSelection = {
  selectedEdgeIds: Set<string>
  bypassEdgeIds: Set<string>
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const pickRandom = <T,>(items: T[]) => {
  if (items.length === 0) {
    return null
  }

  return items[Math.floor(Math.random() * items.length)]!
}

const meshPairKey = (left: string, right: string) => [left, right].sort().join('__')

const createMeshCandidateEdges = (nodeIds: string[]) => {
  const edges: Edge[] = []

  for (let left = 0; left < nodeIds.length; left += 1) {
    for (let right = left + 1; right < nodeIds.length; right += 1) {
      const source = nodeIds[left]!
      const target = nodeIds[right]!
      const edgeId = `mesh-${meshPairKey(source, target)}`
      edges.push(e(edgeId, source, target, 'mesh link'))
    }
  }

  return edges
}

const findRoot = (parent: Map<string, string>, value: string): string => {
  const current = parent.get(value)
  if (!current || current === value) {
    parent.set(value, value)
    return value
  }

  const root = findRoot(parent, current)
  parent.set(value, root)
  return root
}

const unionRoots = (parent: Map<string, string>, rank: Map<string, number>, left: string, right: string) => {
  const leftRoot = findRoot(parent, left)
  const rightRoot = findRoot(parent, right)

  if (leftRoot === rightRoot) {
    return false
  }

  const leftRank = rank.get(leftRoot) ?? 0
  const rightRank = rank.get(rightRoot) ?? 0

  if (leftRank < rightRank) {
    parent.set(leftRoot, rightRoot)
  } else if (leftRank > rightRank) {
    parent.set(rightRoot, leftRoot)
  } else {
    parent.set(rightRoot, leftRoot)
    rank.set(leftRoot, leftRank + 1)
  }

  return true
}

const shortestPathCost = (nodes: string[], edges: Edge[], metricByEdgeId: Record<string, LinkMetric>, source: string, target: string) => {
  const adjacency = new Map<string, Array<{ nodeId: string; cost: number }>>()

  for (const nodeId of nodes) {
    adjacency.set(nodeId, [])
  }

  for (const edge of edges) {
    const metric = metricByEdgeId[edge.id]
    if (!metric) {
      continue
    }

    adjacency.get(edge.source)?.push({ nodeId: edge.target, cost: metric.weight })
    adjacency.get(edge.target)?.push({ nodeId: edge.source, cost: metric.weight })
  }

  const distance = new Map<string, number>()
  const visited = new Set<string>()

  for (const nodeId of nodes) {
    distance.set(nodeId, Number.POSITIVE_INFINITY)
  }

  distance.set(source, 0)

  while (visited.size < nodes.length) {
    let current: string | null = null
    let bestDistance = Number.POSITIVE_INFINITY

    for (const nodeId of nodes) {
      if (visited.has(nodeId)) {
        continue
      }

      const candidate = distance.get(nodeId) ?? Number.POSITIVE_INFINITY
      if (candidate < bestDistance) {
        bestDistance = candidate
        current = nodeId
      }
    }

    if (!current || bestDistance === Number.POSITIVE_INFINITY) {
      break
    }

    if (current === target) {
      return bestDistance
    }

    visited.add(current)

    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next.nodeId)) {
        continue
      }

      const proposal = bestDistance + next.cost
      if (proposal < (distance.get(next.nodeId) ?? Number.POSITIVE_INFINITY)) {
        distance.set(next.nodeId, proposal)
      }
    }
  }

  return distance.get(target) ?? Number.POSITIVE_INFINITY
}

const selectRuleBasedEdges = (nodeIds: string[], candidateEdges: Edge[], metricByEdgeId: Record<string, LinkMetric>): MeshRuleSelection => {
  const selectedEdgeIds = new Set<string>()
  const bypassEdgeIds = new Set<string>()

  if (nodeIds.length <= 1) {
    return { selectedEdgeIds, bypassEdgeIds }
  }

  const ranked = [...candidateEdges].sort((left, right) => {
    const leftWeight = metricByEdgeId[left.id]?.weight ?? Number.POSITIVE_INFINITY
    const rightWeight = metricByEdgeId[right.id]?.weight ?? Number.POSITIVE_INFINITY
    return leftWeight - rightWeight
  })

  const parent = new Map<string, string>()
  const rank = new Map<string, number>()
  const degree = new Map<string, number>()

  for (const nodeId of nodeIds) {
    parent.set(nodeId, nodeId)
    rank.set(nodeId, 0)
    degree.set(nodeId, 0)
  }

  // Rule 1: global connectivity via minimum spanning tree.
  for (const edge of ranked) {
    if (!metricByEdgeId[edge.id]) {
      continue
    }

    if (unionRoots(parent, rank, edge.source, edge.target)) {
      selectedEdgeIds.add(edge.id)
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
    }
  }

  // Rule 2: at least two end-to-end options by enforcing min degree >= 2 when possible.
  for (const nodeId of nodeIds) {
    while ((degree.get(nodeId) ?? 0) < 2) {
      const bestAlternative = ranked.find((edge) =>
        (edge.source === nodeId || edge.target === nodeId) &&
        !selectedEdgeIds.has(edge.id) &&
        metricByEdgeId[edge.id],
      )

      if (!bestAlternative) {
        break
      }

      selectedEdgeIds.add(bestAlternative.id)
      degree.set(bestAlternative.source, (degree.get(bestAlternative.source) ?? 0) + 1)
      degree.set(bestAlternative.target, (degree.get(bestAlternative.target) ?? 0) + 1)
    }
  }

  // Rule 3: bypass logic: if direct route is significantly faster than current routed path, add it.
  const selectedEdges = candidateEdges.filter((edge) => selectedEdgeIds.has(edge.id))

  for (const edge of ranked) {
    if (selectedEdgeIds.has(edge.id)) {
      continue
    }

    const directWeight = metricByEdgeId[edge.id]?.weight
    if (!directWeight) {
      continue
    }

    const routedWeight = shortestPathCost(nodeIds, selectedEdges, metricByEdgeId, edge.source, edge.target)
    const significantlyFaster = directWeight * 1.2 < routedWeight

    if (Number.isFinite(routedWeight) && significantlyFaster) {
      selectedEdgeIds.add(edge.id)
      bypassEdgeIds.add(edge.id)
      selectedEdges.push(edge)
    }
  }

  return { selectedEdgeIds, bypassEdgeIds }
}

function MeshNodeCard({ data }: NodeProps<Node<MeshNodeData>>) {
  return (
    <>
      <Handle type="target" position={Position.Top} className="mesh-handle" />
      <Handle type="target" position={Position.Left} className="mesh-handle" />
      <div className="mesh-node">
        <strong>{data.label}</strong>
        <small>{data.subtitle}</small>
      </div>
      <Handle type="source" position={Position.Bottom} className="mesh-handle" />
      <Handle type="source" position={Position.Right} className="mesh-handle" />
    </>
  )
}

const nodeTypes = {
  meshNode: MeshNodeCard,
}

const marker = { type: MarkerType.ArrowClosed }

const metricOverrides: Record<string, Partial<Record<string, Pick<LinkMetric, 'latencyMs' | 'throughputMbps'>>>> = {
  'first-connection': {
    'a1-a2-connect': { latencyMs: 19, throughputMbps: 1210 },
    'a2-a1-heartbeat': { latencyMs: 14, throughputMbps: 1290 },
    'a2-stream': { latencyMs: 11, throughputMbps: 1460 },
  },
  'shared-super-admin-login': {
    'a3-a6-sync': { latencyMs: 16, throughputMbps: 1180 },
    'a3-a9-sync': { latencyMs: 22, throughputMbps: 980 },
  },
}

const normalize = (value: number, max: number) => Math.max(0, Math.min(1, value / max))

const computeWeight = (latencyMs: number, throughputMbps: number) => {
  const latencyNorm = normalize(latencyMs, 250)
  const throughputNorm = normalize(throughputMbps, 1500)
  return Number((0.7 * latencyNorm + 0.3 * (1 - throughputNorm)).toFixed(3))
}

const hash = (text: string) => {
  let h = 0
  for (let index = 0; index < text.length; index += 1) {
    h = (h * 31 + text.charCodeAt(index)) >>> 0
  }
  return h
}

const deriveMetric = (scenarioId: string, edge: Edge): LinkMetric => {
  const override = metricOverrides[scenarioId]?.[edge.id]
  if (override) {
    const weight = computeWeight(override.latencyMs!, override.throughputMbps!)
    return {
      latencyMs: override.latencyMs!,
      throughputMbps: override.throughputMbps!,
      weight,
    }
  }

  const seed = hash(`${scenarioId}:${edge.id}:${edge.source}:${edge.target}`)
  const latencyMs = 8 + (seed % 72)
  const throughputMbps = 480 + (seed % 1120)
  const weight = computeWeight(latencyMs, throughputMbps)
  return { latencyMs, throughputMbps, weight }
}

const weightToColor = (weight: number) => {
  if (weight <= 0.2) return '#059669'
  if (weight <= 0.35) return '#0891b2'
  if (weight <= 0.5) return '#2563eb'
  if (weight <= 0.7) return '#d97706'
  return '#dc2626'
}

const n = (id: string, x: number, y: number, label: string, subtitle: string): Node<MeshNodeData> => ({
  id,
  position: { x, y },
  data: { label, subtitle },
  type: 'meshNode',
})

const e = (id: string, source: string, target: string, label?: string): Edge => ({
  id,
  source,
  target,
  label,
  markerEnd: marker,
})

const firstConnectionScenario: Scenario = {
  id: 'first-connection',
  title: 'First peer connection flow',
  goal: 'Show how two equal instances become routable through connect + heartbeat + ownership lookup.',
  decentralizationNote:
    'No control master: API-1 and API-2 run the same code and either one can be entrypoint.',
  nodes: [
    n('user', 20, 210, 'Operator', 'Can enter from any server'),
    n('api-1', 300, 80, 'API-1', 'Instance A (equal peer)'),
    n('api-2', 300, 330, 'API-2', 'Instance B (equal peer)'),
    n('stream-owner', 620, 210, 'Owned Stream', '/core/mesh/streams/:id/subscribe'),
  ],
  edges: [
    e('u-a1', 'user', 'api-1', 'initial request'),
    e('a1-a2-connect', 'api-1', 'api-2', 'connectPeer / resume'),
    e('a2-a1-heartbeat', 'api-2', 'api-1', 'heartbeat + metrics'),
    e('a2-stream', 'api-2', 'stream-owner', 'direct owner route'),
  ],
  steps: [
    {
      title: '1) Any server can be entrypoint',
      whatHappens:
        'The operator reaches API-1, but API-2 could have served the same first step. There is no fleet leader.',
      highlightedNodes: ['user', 'api-1'],
      highlightedEdges: ['u-a1'],
      events: ['requireAuth() passes', 'organization scope checked on entry server'],
    },
    {
      title: '2) Session handshake between equals',
      whatHappens:
        'API-1 connects to API-2 using endpointUrl/resumeToken. If already active, it deduplicates, otherwise it creates a new connected session.',
      highlightedNodes: ['api-1', 'api-2'],
      highlightedEdges: ['a1-a2-connect'],
      events: [
        'connectPeer(endpointUrl, resumeToken?)',
        'dedup by endpointUrl or resume by token',
        'peerSessions + activeSessionByEndpointUrl updated',
      ],
    },
    {
      title: '3) Heartbeat makes route quality real',
      whatHappens:
        'API-2 sends peerNodeId and link metrics. API-1 computes connection weight and activePathRank for routing decisions.',
      highlightedNodes: ['api-1', 'api-2'],
      highlightedEdges: ['a2-a1-heartbeat'],
      events: [
        'heartbeatPeer(sessionId, peerNodeId, metrics)',
        'peerConnections edge upserted',
        'weight + rank recomputed',
      ],
    },
    {
      title: '4) Direct owner resolution (no proxy lock-in)',
      whatHappens:
        'Entry server looks up owner candidates and sends client traffic to the owner endpoint directly.',
      highlightedNodes: ['api-1', 'api-2', 'stream-owner'],
      highlightedEdges: ['a2-stream'],
      events: ['lookupResource(stream)', 'planStreamRoute()', 'ownerServerUrl + endpointPath returned'],
    },
  ],
}

const tenNodeIds = Array.from({ length: 10 }, (_, index) => `api-${index + 1}`)
const tenNodePositions = Array.from({ length: 10 }, (_, index) => {
  const angle = (Math.PI * 2 * index) / 10
  const cx = 480
  const cy = 220
  const radius = 190
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
  }
})

const tenMeshNodes = tenNodeIds.map((id, index) =>
  n(id, tenNodePositions[index]!.x, tenNodePositions[index]!.y, id.toUpperCase(), 'equal instance'),
)

const tenMeshRingEdges = tenNodeIds.map((id, index) => {
  const next = tenNodeIds[(index + 1) % tenNodeIds.length]!
  return e(`ring-${id}-${next}`, id, next, 'gossip link')
})

const tenMeshChordEdges = tenNodeIds.map((id, index) => {
  const skip = tenNodeIds[(index + 3) % tenNodeIds.length]!
  return e(`chord-${id}-${skip}`, id, skip, 'shortcut')
})

const tenMeshDenseEdges = (() => {
  const offsets = [2, 4]
  const built: Edge[] = []
  const seen = new Set<string>()

  for (const [index, id] of tenNodeIds.entries()) {
    for (const offset of offsets) {
      const target = tenNodeIds[(index + offset) % tenNodeIds.length]!
      const pairKey = [id, target].sort().join('::')

      if (seen.has(pairKey)) {
        continue
      }

      seen.add(pairKey)
      built.push(e(`dense-${id}-${target}`, id, target, 'sync link'))
    }
  }

  return built
})()

const tenMeshCandidateEdges = createMeshCandidateEdges(tenNodeIds)

const tenInstanceScenario: Scenario = {
  id: 'mesh-10',
  title: '10-instance decentralized mesh algorithm',
  goal: 'Demonstrate mesh formation, anti-entropy, weighted path selection, and failure reroute with 10 equal nodes.',
  decentralizationNote:
    'Every API-N is identical: no coordinator, no singleton router, no primary election requirement for normal operation.',
  nodes: tenMeshNodes,
  edges: [...tenMeshRingEdges, ...tenMeshChordEdges, ...tenMeshDenseEdges],
  steps: [
    {
      title: '1) Bootstrap nearest peers',
      whatHappens:
        'Each node starts by linking to neighbors. Ring links guarantee baseline connectivity from any point.',
      highlightedNodes: ['api-1', 'api-2', 'api-10'],
      highlightedEdges: ['ring-api-1-api-2', 'ring-api-10-api-1'],
      events: ['connectPeer', 'hello envelope', 'membership snapshot v+1'],
    },
    {
      title: '2) Full membership convergence',
      whatHappens:
        'Gossip + anti-entropy reconciliation spreads nodes/sessions/resources until all 10 instances converge on near-identical view.',
      highlightedNodes: tenNodeIds,
      highlightedEdges: tenMeshRingEdges.map((edge) => edge.id),
      events: ['publishControlEnvelope(anti_entropy_sync)', 'reconcileMembership()', 'skippedStale / mergedNodes tracked'],
    },
    {
      title: '3) Weighted multi-path routing',
      whatHappens:
        'Shortcut links create extra capacity. Planner selects lowest-weight branches while still keeping alternates.',
      highlightedNodes: ['api-1', 'api-4', 'api-7', 'api-9'],
      highlightedEdges: ['chord-api-1-api-4', 'chord-api-4-api-7', 'chord-api-7-api-10', 'ring-api-9-api-10'],
      events: ['heartbeat metrics update weights', 'planStreamRoute(desiredBranches=3)', 'selected + candidates returned'],
    },
    {
      title: '4) Link loss and resilient reroute',
      whatHappens:
        'When one path degrades/down, traffic shifts to alternate links immediately; reconnect attempts happen in parallel.',
      highlightedNodes: ['api-4', 'api-5', 'api-7'],
      highlightedEdges: ['ring-api-4-api-5', 'chord-api-4-api-7'],
      events: [
        'disconnectPeer(allowReconnect=true)',
        'nextReconnectAt with backoff+jitter',
        'fallback branch remains active',
      ],
    },
  ],
}

const orgScenario: Scenario = {
  id: 'org-propagation',
  title: 'Organization creation on any server',
  goal: 'Explain how an organization can be created on one server and become available mesh-wide without a central ownership server.',
  decentralizationNote:
    'Org write can enter on any instance. That instance becomes temporary originator, not a permanent master.',
  nodes: [
    n('owner', 30, 220, 'Org Owner', 'Creates organization'),
    n('api-4', 290, 80, 'API-4', 'Write entrypoint this time'),
    n('api-2', 290, 220, 'API-2', 'Equal replica'),
    n('api-8', 290, 360, 'API-8', 'Equal replica'),
    n('org-a', 620, 80, 'Org State @ API-4', 'org_42 metadata + members'),
    n('org-b', 620, 220, 'Org State @ API-2', 'replicated copy'),
    n('org-c', 620, 360, 'Org State @ API-8', 'replicated copy'),
  ],
  edges: [
    e('owner-write', 'owner', 'api-4', 'create org'),
    e('api4-orgA', 'api-4', 'org-a', 'local commit'),
    e('api4-api2', 'api-4', 'api-2', 'gossip event'),
    e('api4-api8', 'api-4', 'api-8', 'gossip event'),
    e('api2-orgB', 'api-2', 'org-b', 'apply replicated change'),
    e('api8-orgC', 'api-8', 'org-c', 'apply replicated change'),
  ],
  steps: [
    {
      title: '1) Org create accepted on API-4',
      whatHappens:
        'Owner sends create-org command to API-4. API-4 validates ownership/auth policy and commits locally.',
      highlightedNodes: ['owner', 'api-4', 'org-a'],
      highlightedEdges: ['owner-write', 'api4-orgA'],
      events: ['requireAuth + org policy', 'organization row created', 'membership event prepared'],
    },
    {
      title: '2) Change is announced to peers',
      whatHappens:
        'API-4 emits topology/control events. API-2 and API-8 fetch/apply missing updates via anti-entropy.',
      highlightedNodes: ['api-4', 'api-2', 'api-8'],
      highlightedEdges: ['api4-api2', 'api4-api8'],
      events: ['publishControlEnvelope()', 'reconcileMembership()', 'resource index upsert for org-owned streams'],
    },
    {
      title: '3) Org is readable from any node',
      whatHappens:
        'After convergence, reads from API-2/API-8 return the same org ownership model; request can start anywhere.',
      highlightedNodes: ['org-a', 'org-b', 'org-c', 'api-2', 'api-8'],
      highlightedEdges: ['api2-orgB', 'api8-orgC'],
      events: ['consistent org membership checks', 'owner/member permissions enforce identically on each node'],
    },
  ],
}

const loginScenario: Scenario = {
  id: 'shared-super-admin-login',
  title: 'First login flow with shared super-admin across instances',
  goal: 'Explain multi-instance login where super-admin identity is shared and recognized by every server.',
  decentralizationNote:
    'Super-admin identity material is shared/replicated. Any instance can authenticate and issue session context.',
  nodes: [
    n('super-admin', 20, 200, 'Super Admin', 'first login attempt'),
    n('api-3', 280, 90, 'API-3', 'receives login request'),
    n('api-6', 280, 300, 'API-6', 'peer verifier'),
    n('api-9', 520, 200, 'API-9', 'peer verifier'),
    n('token', 760, 200, 'Mesh-Accepted Session', 'session accepted on all peers'),
  ],
  edges: [
    e('sa-login', 'super-admin', 'api-3', 'login POST'),
    e('a3-a6-sync', 'api-3', 'api-6', 'session propagation'),
    e('a3-a9-sync', 'api-3', 'api-9', 'session propagation'),
    e('a6-token', 'api-6', 'token', 'accept jti/session'),
    e('a9-token', 'api-9', 'token', 'accept jti/session'),
  ],
  steps: [
    {
      title: '1) First login can hit any instance',
      whatHappens:
        'Super-admin submits credentials to API-3 (could be any node). API-3 validates using shared identity source.',
      highlightedNodes: ['super-admin', 'api-3'],
      highlightedEdges: ['sa-login'],
      events: ['credential verification', 'super-admin role resolution', 'initial auth session built'],
    },
    {
      title: '2) Session context is shared mesh-wide',
      whatHappens:
        'API-3 spreads session context/jti to peers. This avoids sticky routing requirements for privileged operators.',
      highlightedNodes: ['api-3', 'api-6', 'api-9'],
      highlightedEdges: ['a3-a6-sync', 'a3-a9-sync'],
      events: ['remoteAuthSession metadata sync', 'mesh runtime event emitted', 'peers cache acceptance window'],
    },
    {
      title: '3) Any peer accepts subsequent admin actions',
      whatHappens:
        'Admin can move to API-6/API-9 and continue safely. Authorization checks still run per request, per org scope.',
      highlightedNodes: ['api-6', 'api-9', 'token'],
      highlightedEdges: ['a6-token', 'a9-token'],
      events: ['requireAuth() on each request', 'org/project permission check remains local+deterministic'],
    },
  ],
}

const eventDistributionScenario: Scenario = {
  id: 'event-distribution-discovery',
  title: 'Event discovery + cross-mesh subscription',
  goal:
    'Show how any node can discover event ownership, then route live subscription with either redirect-to-owner or seamless server-to-server bridge.',
  decentralizationNote:
    'All nodes keep open mesh links for continuous discovery (owners, deployment locations, resources, capacities). Entry node is arbitrary; ownership can live anywhere.',
  nodes: [
    n('client', 10, 215, 'Client App', 'subscribe to deployment stream'),
    n('server-1', 270, 215, 'Server-1', 'entrypoint / query + discover'),
    n('server-2', 500, 80, 'Server-2', 'peer index replica'),
    n('server-3', 500, 350, 'Server-3', 'peer index replica'),
    n('server-4', 760, 215, 'Server-4', 'event owner in memory'),
    n('event-owner', 1020, 215, 'event://deployments/abc', 'hot stream in owner memory'),
  ],
  edges: [
    e('client-s1-sub', 'client', 'server-1', 'subscribe request'),
    e('s1-s2-discover', 'server-1', 'server-2', 'who owns event?'),
    e('s1-s3-discover', 'server-1', 'server-3', 'who owns event?'),
    e('s2-s4-owner', 'server-2', 'server-4', 'owner candidate=server-4'),
    e('s3-s4-owner', 'server-3', 'server-4', 'owner candidate=server-4'),
    e('s1-client-redirect', 'server-1', 'client', 'owner endpoint response'),
    e('client-s4-direct', 'client', 'server-4', 'direct subscribe (redirect mode)'),
    e('s1-s4-bridge-open', 'server-1', 'server-4', 'open stream bridge (no redirect mode)'),
    e('s4-event-source', 'server-4', 'event-owner', 'read owner memory stream'),
    e('s4-s1-stream', 'server-4', 'server-1', 'forward event frames'),
    e('s1-client-stream', 'server-1', 'client', 'deliver stream frames'),
  ],
  steps: [
    {
      title: '1) Subscribe can start from any server',
      whatHappens:
        'Client connects to Server-1, but this could be any reachable node. Mesh links stay open for fast research/discovery at all times.',
      highlightedNodes: ['client', 'server-1'],
      highlightedEdges: ['client-s1-sub'],
      events: [
        'subscribe(eventKey=deployments/abc) hits entry server',
        'entry node validates auth/org scope',
        'lookup starts from local index + open mesh peers',
      ],
    },
    {
      title: '2) Mesh discovers who owns the stream',
      whatHappens:
        'Server-1 queries peer indexes. Server-2/Server-3 confirm Server-4 is owner for this event stream currently held in memory.',
      highlightedNodes: ['server-1', 'server-2', 'server-3', 'server-4'],
      highlightedEdges: ['s1-s2-discover', 's1-s3-discover', 's2-s4-owner', 's3-s4-owner'],
      events: [
        'queryResourceOwners(eventKey)',
        'owner candidate ranking from mesh metadata',
        'owner endpoint + capability returned to entry node',
      ],
    },
    {
      title: '3) Option A: redirect client to owner',
      whatHappens:
        'Server-1 answers with owner endpoint (Server-4). Client reconnects directly for shortest path and minimal relay overhead.',
      highlightedNodes: ['server-1', 'client', 'server-4', 'event-owner'],
      highlightedEdges: ['s1-client-redirect', 'client-s4-direct', 's4-event-source'],
      events: [
        'response contains ownerServerUrl + subscribePath',
        'client opens direct stream to owner',
        'events emitted from owner memory to client',
      ],
    },
    {
      title: '4) Option B: no redirect, bridge stream through mesh',
      whatHappens:
        'If redirection is undesirable, Server-1 opens a durable stream bridge to Server-4. Client stays connected to Server-1 with no interruption.',
      highlightedNodes: ['server-1', 'server-4', 'event-owner', 'client'],
      highlightedEdges: ['s1-s4-bridge-open', 's4-event-source', 's4-s1-stream', 's1-client-stream'],
      events: [
        'entry↔owner stream tunnel established',
        'owner pushes event frames to entry node',
        'entry relays frames to client while keeping local session stable',
      ],
    },
  ],
}

const envPromotionScenario: Scenario = {
  id: 'env-promotion-dev-staging-prod',
  title: 'Environment promotion: dev → staging → prod',
  goal:
    'Illustrate how ownership and stream/event metadata move across environments while keeping mesh discovery always available.',
  decentralizationNote:
    'Each environment has equal peers; promotion updates ownership/resource metadata, not a central routing table.',
  nodes: [
    n('dev-a', 120, 70, 'DEV-A', 'feature builds + smoke streams'),
    n('dev-b', 120, 270, 'DEV-B', 'dev peer'),
    n('stg-a', 430, 70, 'STG-A', 'pre-prod validation owner'),
    n('stg-b', 430, 270, 'STG-B', 'staging peer'),
    n('prod-a', 760, 70, 'PROD-A', 'production owner candidate'),
    n('prod-b', 760, 270, 'PROD-B', 'production peer'),
    n('consumer', 1020, 170, 'Client Consumer', 'subscribes from anywhere'),
  ],
  edges: [
    e('dev-sync', 'dev-a', 'dev-b', 'dev mesh sync'),
    e('dev-to-stg', 'dev-a', 'stg-a', 'promote metadata'),
    e('stg-sync', 'stg-a', 'stg-b', 'staging sync'),
    e('stg-to-prod', 'stg-a', 'prod-a', 'approved promotion'),
    e('prod-sync', 'prod-a', 'prod-b', 'prod mesh sync'),
    e('consumer-any', 'consumer', 'dev-b', 'entrypoint can be any node'),
    e('discover-prod-owner', 'dev-b', 'prod-a', 'discover final owner'),
    e('consumer-prod-stream', 'consumer', 'prod-a', 'direct prod stream'),
  ],
  steps: [
    {
      title: '1) Dev ownership starts local',
      whatHappens:
        'Dev peers own early event streams and keep resource index entries warm for quick discovery.',
      highlightedNodes: ['dev-a', 'dev-b'],
      highlightedEdges: ['dev-sync'],
      events: ['upsertResourceIndex(dev)', 'heartbeat updates quality', 'list/subscribe events in dev'],
    },
    {
      title: '2) Promotion updates owner metadata',
      whatHappens:
        'After validation, ownership metadata is promoted to staging then production while mesh discovery remains continuous.',
      highlightedNodes: ['dev-a', 'stg-a', 'stg-b', 'prod-a', 'prod-b'],
      highlightedEdges: ['dev-to-stg', 'stg-sync', 'stg-to-prod', 'prod-sync'],
      events: ['publish promotion envelope', 'reconcileMembership across env edges', 'new owner candidates ranked'],
    },
    {
      title: '3) Client enters anywhere, lands on prod owner',
      whatHappens:
        'A client entering from a dev-side gateway still discovers the production owner and subscribes directly.',
      highlightedNodes: ['consumer', 'dev-b', 'prod-a'],
      highlightedEdges: ['consumer-any', 'discover-prod-owner', 'consumer-prod-stream'],
      events: ['lookupResource(stream)', 'planStreamRoute()', 'direct owner subscription'],
    },
  ],
}

const multiRegionProdScenario: Scenario = {
  id: 'multi-region-prod',
  title: 'Multi-region production mesh',
  goal: 'Show region-aware discovery where local region is preferred but remote region can instantly serve on degradation.',
  decentralizationNote:
    'No global leader region. Each region can discover and serve resources with weighted locality preference.',
  nodes: [
    n('eu-1', 120, 80, 'EU-1', 'eu-west owner candidate'),
    n('eu-2', 120, 280, 'EU-2', 'eu-west peer'),
    n('us-1', 470, 80, 'US-1', 'us-east owner candidate'),
    n('us-2', 470, 280, 'US-2', 'us-east peer'),
    n('ap-1', 810, 180, 'AP-1', 'ap-south fallback region'),
    n('global-user', 1020, 180, 'Global User', 'can enter nearest region'),
  ],
  edges: [
    e('eu-sync', 'eu-1', 'eu-2', 'regional sync'),
    e('us-sync', 'us-1', 'us-2', 'regional sync'),
    e('eu-us-backbone', 'eu-1', 'us-1', 'inter-region backbone'),
    e('us-ap-backbone', 'us-1', 'ap-1', 'inter-region backbone'),
    e('eu-ap-backbone', 'eu-2', 'ap-1', 'inter-region backup'),
    e('user-to-eu', 'global-user', 'eu-2', 'nearest entry'),
    e('eu-route-local', 'eu-2', 'eu-1', 'local low-latency path'),
    e('eu-route-remote', 'eu-2', 'us-1', 'remote bypass if faster'),
  ],
  steps: [
    {
      title: '1) Regional baseline sync',
      whatHappens:
        'Each region keeps local ownership info fresh and shares summarized metadata across backbones.',
      highlightedNodes: ['eu-1', 'eu-2', 'us-1', 'us-2', 'ap-1'],
      highlightedEdges: ['eu-sync', 'us-sync', 'eu-us-backbone', 'us-ap-backbone', 'eu-ap-backbone'],
      events: ['region heartbeat', 'owner index exchange', 'capacity gossip'],
    },
    {
      title: '2) User enters nearest edge',
      whatHappens:
        'Entry node starts local-route first, then checks for bypass if remote path becomes significantly faster.',
      highlightedNodes: ['global-user', 'eu-2', 'eu-1', 'us-1'],
      highlightedEdges: ['user-to-eu', 'eu-route-local', 'eu-route-remote'],
      events: ['planStreamRoute with locality bias', 'bypass check (20% faster)', 'selected owner route'],
    },
    {
      title: '3) Regional degradation recovery',
      whatHappens:
        'If EU owner degrades, mesh instantly pivots to US/AP candidate while keeping subscription continuity.',
      highlightedNodes: ['eu-2', 'us-1', 'ap-1'],
      highlightedEdges: ['eu-route-remote', 'us-ap-backbone'],
      events: ['disconnectPeer allowReconnect', 'candidate re-rank', 'seamless failover route'],
    },
  ],
}

const previewBurstScenario: Scenario = {
  id: 'preview-burst-environments',
  title: 'Preview environment burst handling',
  goal: 'Demonstrate rapid creation/removal of short-lived preview servers and continuous ownership discovery.',
  decentralizationNote:
    'Preview nodes join as equals, publish ownership/resources, then leave cleanly without central broker edits.',
  nodes: [
    n('gateway', 90, 180, 'Gateway Node', 'entry for preview consumers'),
    n('pr-201', 380, 40, 'PR-201', 'preview owner'),
    n('pr-202', 380, 180, 'PR-202', 'preview owner'),
    n('pr-203', 380, 320, 'PR-203', 'preview owner'),
    n('stable', 700, 180, 'Stable Node', 'fallback + index retention'),
    n('qa-user', 980, 180, 'QA User', 'subscribes to preview events'),
  ],
  edges: [
    e('gw-pr201', 'gateway', 'pr-201', 'discover PR-201 owner'),
    e('gw-pr202', 'gateway', 'pr-202', 'discover PR-202 owner'),
    e('gw-pr203', 'gateway', 'pr-203', 'discover PR-203 owner'),
    e('pr-sync-stable', 'pr-202', 'stable', 'index handoff'),
    e('qa-gw', 'qa-user', 'gateway', 'subscribe by PR key'),
    e('qa-direct-pr', 'qa-user', 'pr-202', 'direct stream when alive'),
    e('qa-stable-fallback', 'qa-user', 'stable', 'fallback when PR expires'),
  ],
  steps: [
    {
      title: '1) Previews join quickly',
      whatHappens:
        'New preview nodes announce themselves and upsert stream/resource ownership indexes immediately.',
      highlightedNodes: ['gateway', 'pr-201', 'pr-202', 'pr-203'],
      highlightedEdges: ['gw-pr201', 'gw-pr202', 'gw-pr203'],
      events: ['hello envelopes for preview nodes', 'upsertResourceIndex(stream:pr-*)', 'owner lookup becomes available'],
    },
    {
      title: '2) QA subscribes from gateway',
      whatHappens:
        'QA user asks by preview key; gateway resolves current owner and routes directly when possible.',
      highlightedNodes: ['qa-user', 'gateway', 'pr-202'],
      highlightedEdges: ['qa-gw', 'gw-pr202', 'qa-direct-pr'],
      events: ['lookup by PR key', 'plan route to preview owner', 'direct event stream'],
    },
    {
      title: '3) Preview expires, fallback continues',
      whatHappens:
        'On preview teardown, ownership is removed and stable node serves remaining telemetry/history streams.',
      highlightedNodes: ['pr-202', 'stable', 'qa-user'],
      highlightedEdges: ['pr-sync-stable', 'qa-stable-fallback'],
      events: ['membership_remove for preview', 'resource index eviction', 'fallback subscription path'],
    },
  ],
}

const tenantIsolationScenario: Scenario = {
  id: 'tenant-isolated-environments',
  title: 'Multi-tenant environment isolation',
  goal: 'Explain shared infrastructure with strict tenant/org isolation and per-tenant event ownership discovery.',
  decentralizationNote:
    'Nodes are shared but policy enforcement is local and deterministic on every server for each tenant/org scope.',
  nodes: [
    n('tenant-a-ui', 60, 100, 'Tenant-A User', 'org A scope'),
    n('tenant-b-ui', 60, 280, 'Tenant-B User', 'org B scope'),
    n('shared-1', 350, 80, 'Shared-1', 'mesh peer (policy aware)'),
    n('shared-2', 350, 280, 'Shared-2', 'mesh peer (policy aware)'),
    n('owner-a', 700, 80, 'Owner-A', 'org A streams'),
    n('owner-b', 700, 280, 'Owner-B', 'org B streams'),
  ],
  edges: [
    e('a-entry', 'tenant-a-ui', 'shared-1', 'tenant A request'),
    e('b-entry', 'tenant-b-ui', 'shared-2', 'tenant B request'),
    e('shared-mesh', 'shared-1', 'shared-2', 'shared discovery mesh'),
    e('discover-a', 'shared-1', 'owner-a', 'discover org A owner'),
    e('discover-b', 'shared-2', 'owner-b', 'discover org B owner'),
    e('a-owner-stream', 'tenant-a-ui', 'owner-a', 'tenant A stream'),
    e('b-owner-stream', 'tenant-b-ui', 'owner-b', 'tenant B stream'),
  ],
  steps: [
    {
      title: '1) Tenant-scoped entry',
      whatHappens:
        'Both tenants enter shared mesh nodes, but auth + org checks partition visibility and candidate owners.',
      highlightedNodes: ['tenant-a-ui', 'tenant-b-ui', 'shared-1', 'shared-2'],
      highlightedEdges: ['a-entry', 'b-entry', 'shared-mesh'],
      events: ['requireAuth', 'organization membership check', 'tenant-scoped lookup query'],
    },
    {
      title: '2) Ownership discovery stays scoped',
      whatHappens:
        'Shared nodes discover owner-A for tenant A and owner-B for tenant B without cross-tenant leakage.',
      highlightedNodes: ['shared-1', 'shared-2', 'owner-a', 'owner-b'],
      highlightedEdges: ['discover-a', 'discover-b'],
      events: ['lookupResource with org filter', 'owner candidates filtered by tenant scope'],
    },
    {
      title: '3) Streaming from anywhere, still isolated',
      whatHappens:
        'Each tenant streams directly to its owner while mesh remains shared and decentralized.',
      highlightedNodes: ['tenant-a-ui', 'owner-a', 'tenant-b-ui', 'owner-b'],
      highlightedEdges: ['a-owner-stream', 'b-owner-stream'],
      events: ['direct subscription to scoped owner', 'policy check on every frame path'],
    },
  ],
}

const disasterRecoveryScenario: Scenario = {
  id: 'disaster-recovery-environment',
  title: 'Disaster recovery (primary to DR)',
  goal: 'Model DR failover where primary environment goes down and mesh discovery promotes DR owners with minimal interruption.',
  decentralizationNote:
    'Primary and DR both participate as peers ahead of time; DR activation is route/ownership switch, not central rebuild.',
  nodes: [
    n('user-dr', 50, 180, 'Ops User', 'active stream consumer'),
    n('primary-a', 320, 80, 'Primary-A', 'active owner before incident'),
    n('primary-b', 320, 280, 'Primary-B', 'primary peer'),
    n('dr-a', 680, 80, 'DR-A', 'warm standby owner'),
    n('dr-b', 680, 280, 'DR-B', 'DR peer'),
    n('archive', 980, 180, 'Recovery Archive', 'state snapshots + replay'),
  ],
  edges: [
    e('user-primary', 'user-dr', 'primary-a', 'normal stream path'),
    e('primary-sync', 'primary-a', 'primary-b', 'primary sync'),
    e('cross-replication', 'primary-b', 'dr-a', 'replication + ownership mirror'),
    e('dr-sync', 'dr-a', 'dr-b', 'dr sync'),
    e('dr-archive', 'dr-a', 'archive', 'snapshot/replay source'),
    e('user-dr-route', 'user-dr', 'dr-a', 'post-failover stream path'),
  ],
  steps: [
    {
      title: '1) Normal primary ownership',
      whatHappens:
        'User streams from primary owner while cross-env replication keeps DR candidates up to date.',
      highlightedNodes: ['user-dr', 'primary-a', 'primary-b', 'dr-a'],
      highlightedEdges: ['user-primary', 'primary-sync', 'cross-replication'],
      events: ['active stream in primary', 'continuous replication to DR', 'DR owner metadata warm'],
    },
    {
      title: '2) Primary incident detected',
      whatHappens:
        'Primary degrades/down; mesh removes unhealthy owners and promotes DR owner candidates automatically.',
      highlightedNodes: ['primary-a', 'dr-a', 'dr-b'],
      highlightedEdges: ['cross-replication', 'dr-sync'],
      events: ['membership_suspect/remove', 'resource owner re-rank', 'route plan pivots to DR'],
    },
    {
      title: '3) Stream resumes from DR',
      whatHappens:
        'User continues through DR route, optionally replaying short gaps from archive-backed snapshot stream.',
      highlightedNodes: ['user-dr', 'dr-a', 'archive'],
      highlightedEdges: ['user-dr-route', 'dr-archive'],
      events: ['direct DR subscription', 'optional replay window', 'steady-state DR serving'],
    },
  ],
}

const scenarios: Scenario[] = [
  firstConnectionScenario,
  tenInstanceScenario,
  eventDistributionScenario,
  envPromotionScenario,
  multiRegionProdScenario,
  previewBurstScenario,
  tenantIsolationScenario,
  disasterRecoveryScenario,
  orgScenario,
  loginScenario,
]

export default function App() {
  const [scenarioIndex, setScenarioIndex] = useState(0)
  const [stepIndex, setStepIndex] = useState(0)
  const [simulationEnabled, setSimulationEnabled] = useState(true)
  const [meshNodeOnlineState, setMeshNodeOnlineState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(tenNodeIds.map((nodeId) => [nodeId, true])),
  )
  const [liveMeshMetrics, setLiveMeshMetrics] = useState<Record<string, LinkMetric>>({})

  const scenario = scenarios[scenarioIndex]!
  const step = scenario.steps[stepIndex]!

  useEffect(() => {
    if (!simulationEnabled) {
      return
    }

    const interval = setInterval(() => {
      setMeshNodeOnlineState((current) => {
        const entries = Object.entries(current)
        const online = entries.filter(([, isOnline]) => isOnline).map(([nodeId]) => nodeId)
        const offline = entries.filter(([, isOnline]) => !isOnline).map(([nodeId]) => nodeId)
        const next = { ...current }

        const shouldDrop = Math.random() < 0.22 && online.length > 6
        const shouldJoin = Math.random() < 0.35 && offline.length > 0

        if (shouldDrop) {
          const toDrop = pickRandom(online)
          if (toDrop) {
            next[toDrop] = false
          }
        }

        if (shouldJoin) {
          const toJoin = pickRandom(offline)
          if (toJoin) {
            next[toJoin] = true
          }
        }

        return next
      })

      setLiveMeshMetrics((current) => {
        const next: Record<string, LinkMetric> = {}

        for (const edge of tenMeshCandidateEdges) {
          const base = current[edge.id] ?? deriveMetric('mesh-10', edge)
          const nextLatency = clamp(base.latencyMs + (Math.random() * 26 - 13), 6, 220)
          const nextThroughput = clamp(base.throughputMbps + (Math.random() * 180 - 90), 180, 1800)

          next[edge.id] = {
            latencyMs: Number(nextLatency.toFixed(0)),
            throughputMbps: Number(nextThroughput.toFixed(0)),
            weight: computeWeight(nextLatency, nextThroughput),
          }
        }

        return next
      })
    }, 1300)

    return () => clearInterval(interval)
  }, [simulationEnabled])

  const nodes = useMemo(() => {
    const baseNodes = scenario.id === 'mesh-10'
      ? scenario.nodes.filter((node) => meshNodeOnlineState[node.id] ?? true)
      : scenario.nodes

    return baseNodes.map((node) => {
      const active = step.highlightedNodes.includes(node.id)
      const isMeshNode = scenario.id === 'mesh-10' && node.id.startsWith('api-')
      const isOnline = isMeshNode ? (meshNodeOnlineState[node.id] ?? true) : true
      return {
        ...node,
        style: active ? ACTIVE_NODE_STYLE : INACTIVE_NODE_STYLE,
        data: {
          ...node.data,
          subtitle: isMeshNode ? `${isOnline ? 'online' : 'offline'} • ${node.data.subtitle}` : node.data.subtitle,
          active,
        },
      }
    })
  }, [meshNodeOnlineState, scenario, step])

  const metricsByEdgeId = useMemo(() => {
    const baseEdges = scenario.id === 'mesh-10' ? tenMeshCandidateEdges : scenario.edges
    const entries = baseEdges.map((edge) => [edge.id, deriveMetric(scenario.id, edge)] as const)
    return Object.fromEntries(entries) as Record<string, LinkMetric>
  }, [scenario])

  const meshRuleSelection = useMemo(() => {
    if (scenario.id !== 'mesh-10') {
      return null
    }

    const activeNodeIds = tenNodeIds.filter((nodeId) => meshNodeOnlineState[nodeId] ?? true)
    const activeCandidates = tenMeshCandidateEdges.filter((edge) =>
      (meshNodeOnlineState[edge.source] ?? true) && (meshNodeOnlineState[edge.target] ?? true),
    )

    const metricLookup: Record<string, LinkMetric> = {}
    for (const edge of activeCandidates) {
      metricLookup[edge.id] = liveMeshMetrics[edge.id] ?? metricsByEdgeId[edge.id] ?? deriveMetric('mesh-10', edge)
    }

    return selectRuleBasedEdges(activeNodeIds, activeCandidates, metricLookup)
  }, [liveMeshMetrics, meshNodeOnlineState, metricsByEdgeId, scenario.id])

  const edges = useMemo(() => {
    const candidateEdges = scenario.id === 'mesh-10'
      ? tenMeshCandidateEdges.filter((edge) =>
          (meshNodeOnlineState[edge.source] ?? true) && (meshNodeOnlineState[edge.target] ?? true),
        )
      : scenario.edges

    const constrainedEdges = scenario.id === 'mesh-10' && meshRuleSelection
      ? candidateEdges.filter((edge) => meshRuleSelection.selectedEdgeIds.has(edge.id))
      : candidateEdges

    return constrainedEdges.map((edge) => {
      const active = step.highlightedEdges.includes(edge.id)
      const metric = scenario.id === 'mesh-10'
        ? liveMeshMetrics[edge.id] ?? metricsByEdgeId[edge.id] ?? deriveMetric(scenario.id, edge)
        : metricsByEdgeId[edge.id] ?? deriveMetric(scenario.id, edge)
      const baseColor = weightToColor(metric.weight)
      const widthFromWeight = 1.2 + (1 - metric.weight) * 3.4
      const isBypass = scenario.id === 'mesh-10' && meshRuleSelection?.bypassEdgeIds.has(edge.id)
      return {
        ...edge,
        animated: active || metric.weight <= 0.3,
        label: `${isBypass ? 'bypass' : edge.label ?? 'link'} · ${metric.latencyMs}ms · ${metric.throughputMbps}Mbps · w:${metric.weight.toFixed(2)}`,
        style: {
          stroke: active ? '#4f46e5' : isBypass ? '#7c3aed' : baseColor,
          strokeWidth: active ? widthFromWeight + 1.2 : widthFromWeight,
          opacity: active ? 1 : 0.9,
          strokeDasharray: isBypass ? '6 4' : undefined,
        },
        labelStyle: {
          fill: active ? '#312e81' : '#475569',
          fontWeight: active ? 700 : 500,
          fontSize: 11,
        },
      }
    })
  }, [liveMeshMetrics, meshNodeOnlineState, meshRuleSelection, metricsByEdgeId, scenario, step])

  const selectScenario = (index: number) => {
    setScenarioIndex(index)
    setStepIndex(0)
  }

  const next = () => setStepIndex((index) => (index + 1) % scenario.steps.length)
  const prev = () => setStepIndex((index) => (index - 1 + scenario.steps.length) % scenario.steps.length)

  const explanatoryPoints = [
    'All instances are equal peers: no centralized router or mandatory coordinator.',
    'User/org authorization happens on every serving node, not only where traffic enters.',
    'Mesh layer answers “where is the owner?”, business layer answers “is this user/org allowed?”.',
    'Reconnection uses resume tokens + weighted reroute, so continuity survives partial outages.',
    'Link weight in this demo is computed from latency (time to reach) and throughput (connection speed).',
  ]

  return (
    <div className="app-shell">
      <header className="header">
        <h1>Core Sync System PoC</h1>
        <p>
          Interactive React Flow demo pack: first connection, 10-instance mesh formation, event discovery +
          cross-mesh subscription routing, org replication, and shared super-admin login across equal servers.
        </p>
      </header>

      <section className="scenario-strip">
        {scenarios.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={index === scenarioIndex ? 'scenario-button active' : 'scenario-button'}
            onClick={() => selectScenario(index)}
          >
            {item.title}
          </button>
        ))}

        {scenario.id === 'mesh-10' ? (
          <button
            type="button"
            className={simulationEnabled ? 'scenario-button active' : 'scenario-button'}
            onClick={() => setSimulationEnabled((enabled) => !enabled)}
          >
            {simulationEnabled ? 'Live simulation: ON' : 'Live simulation: OFF'}
          </button>
        ) : null}
      </section>

      <main className="layout">
        <section className="canvas-card">
          <ReactFlow fitView nodes={nodes} edges={edges} nodeTypes={nodeTypes}>
            <MiniMap zoomable pannable />
            <Controls showInteractive={false} />
            <Background gap={20} size={1} />
          </ReactFlow>
        </section>

        <aside className="side-panel">
          <div className="step-chip">Scenario {scenarioIndex + 1} / {scenarios.length}</div>
          <h2>{scenario.title}</h2>
          <p>{scenario.goal}</p>

          <h3>Decentralization guarantee</h3>
          <p>{scenario.decentralizationNote}</p>

          <div className="step-chip">Step {stepIndex + 1} / {scenario.steps.length}</div>
          <h2>{step.title}</h2>
          <p>{step.whatHappens}</p>

          <h3>Runtime events</h3>
          <ul>
            {step.events.map((event) => (
              <li key={event}>{event}</li>
            ))}
          </ul>

          <h3>Design notes</h3>
          <ul>
            {explanatoryPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>

          {scenario.id === 'mesh-10' ? (
            <>
              <h3>Live mesh status</h3>
              <p>
                Online nodes:{' '}
                {Object.values(meshNodeOnlineState).filter(Boolean).length}
                {' / '}
                {tenNodeIds.length}
              </p>
              <p>
                Graph continuously re-invents itself with metric drift and peer arrival/departure.
              </p>
              <p>
                Routing rules: global connectivity + min-2 links per active node + bypass links when a direct path is at least 20% faster.
              </p>
            </>
          ) : null}

          <div className="actions">
            <button onClick={prev} type="button">Previous</button>
            <button onClick={next} type="button">Next</button>
          </div>
        </aside>
      </main>
    </div>
  )
}

const ACTIVE_NODE_STYLE: CSSProperties = {
  border: '2px solid #4f46e5',
  boxShadow: '0 0 0 6px rgba(79,70,229,0.12)',
  borderRadius: 14,
  padding: 0,
  background: '#eef2ff',
}

const INACTIVE_NODE_STYLE: CSSProperties = {
  border: '1px solid #d4d4d8',
  borderRadius: 14,
  padding: 0,
  background: '#ffffff',
}