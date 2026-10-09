export interface MeshRoutePlanHistoryEntry {
  at: string
  streamId: string
  selected: number
  candidates: number
  topOwner: string | null
}

export type MeshLookupKind = 'stream' | 'queue' | 'deployment' | 'log'

export interface MeshLookupHistoryEntry {
  at: string
  kind: MeshLookupKind
  key: string
  found: boolean
  owner: string | null
  candidates: number
}

/** History lists keep the newest few entries only. */
export const HISTORY_LIMIT = 8
