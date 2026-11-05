import type {
    DockerImageInspectDetail,
    DockerImageLayerEfficiency,
    DockerImageScannerResult,
    DockerImageSecurityScanEvent,
    DockerImageSecurityScanSummary,
    DockerVulnerabilityEntry,
} from '@deployer/contracts-entities'
import type { ScannerType } from '@deployer/docker'

export const VULNERABILITY_SCAN_TIMEOUT_MS = 120_000
export const VULNERABILITY_LOG_POLL_INTERVAL_MS = 500
export const VULNERABILITY_LOG_TAIL = 10_000
export const DEFAULT_IMAGE_SCAN_SCANNER_PARALLELISM = 3

export type ResolvedImageSecurityScan = {
    vulnerabilities: DockerImageInspectDetail['vulnerabilities']
    scanSummary: DockerImageInspectDetail['scanSummary']
}

export type DockerImageLifecycleRecord = {
    imageIdentifierNormalized: string
    currentGeneration: number
    lifecycleState: 'alive' | 'deleted'
}

export type DockerImageLifecycleUpsertResult = {
    imageIdentifierNormalized: string
    imageGeneration: number
    revived: boolean
}

export type RawImageSecurityScan = {
    vulnerabilities: DockerImageInspectDetail['vulnerabilities']
    scanSummary: Omit<
        NonNullable<DockerImageInspectDetail['scanSummary']>,
        'cached'
    >
}

export type ScannerRunResult = {
    vulnerabilities: DockerVulnerabilityEntry[]
    scannerResult: DockerImageScannerResult
    layerEfficiency: DockerImageLayerEfficiency | null
}

export type ScannerRunProgressOptions = {
    logPollIntervalMs?: number
    onEvent?: (event: DockerImageSecurityScanEvent) => void
    imageId?: string
}

export type ScannerExecutionResult = {
    scanner: 'trivy' | 'grype' | 'dive'
    exitCode: number
    output: string
    durationMs: number
    executedAt: string
}

export type ScannerExecutionConfig = {
    scanner: 'trivy' | 'grype' | 'dive'
    image: string
    command: string[]
}

export type ScannerExecutionProgressOptions = {
    logPollIntervalMs?: number
    onLogLine?: (line: string) => void
    onPullLogLine?: (line: string) => void
}
