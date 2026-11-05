export interface MeshLookupHistoryEntry {
    at: string
    service: string
    key: string | null
    found: boolean
    /** The node the call would reach. */
    node: string | null
    reason: string | null
}

/** History lists keep the newest few entries only. */
export const HISTORY_LIMIT = 8
