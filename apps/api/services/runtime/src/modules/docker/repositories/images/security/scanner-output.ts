/**
 * Reading what the image scanners print: Trivy and Grype vulnerability reports, Dive layer efficiency, and the
 * progress events built from them. Pure functions over scanner output, so the parsing is tested without a scanner.
 */
import { nonEmptyString } from '@deployer/type-guards'
import type {
    DockerImageLayerEfficiency,
    DockerImageSecurityScanEvent,
    DockerVulnerabilityEntry,
} from '@deployer/contracts-entities'

export type BuildScanEventInput = {
    imageId: string
    type: DockerImageSecurityScanEvent['type']
    stage: DockerImageSecurityScanEvent['stage']
    scanner: DockerImageSecurityScanEvent['scanner']
    message: string
    progress: DockerImageSecurityScanEvent['progress']
    logLine: DockerImageSecurityScanEvent['logLine']
    scannerResult?: DockerImageSecurityScanEvent['scannerResult']
    scanSummary?: DockerImageSecurityScanEvent['scanSummary']
    vulnerabilities?: DockerImageSecurityScanEvent['vulnerabilities']
}

export function parseTrivyVulnerabilities(
    output: string
): DockerVulnerabilityEntry[] {
    let parsed: unknown
    try {
        parsed = JSON.parse(output)
    } catch {
        return []
    }

    if (typeof parsed !== 'object' || parsed === null) {
        return []
    }

    const results = Array.isArray((parsed as { Results?: unknown }).Results)
        ? (parsed as { Results: unknown[] }).Results
        : []

    const vulnerabilities: DockerVulnerabilityEntry[] = []

    for (const result of results) {
        if (typeof result !== 'object' || result === null) {
            continue
        }

        const records = Array.isArray(
            (result as { Vulnerabilities?: unknown }).Vulnerabilities
        )
            ? (result as { Vulnerabilities: unknown[] }).Vulnerabilities
            : []

        for (const record of records) {
            const normalized = normalizeScannerVulnerability(record, 'trivy')
            if (normalized) {
                vulnerabilities.push(normalized)
            }
        }
    }

    return vulnerabilities
}

export function parseGrypeVulnerabilities(
    output: string
): DockerVulnerabilityEntry[] {
    let parsed: unknown
    try {
        parsed = JSON.parse(output)
    } catch {
        return []
    }

    if (typeof parsed !== 'object' || parsed === null) {
        return []
    }

    const matches = Array.isArray((parsed as { matches?: unknown }).matches)
        ? (parsed as { matches: unknown[] }).matches
        : []

    const vulnerabilities: DockerVulnerabilityEntry[] = []

    for (const match of matches) {
        const normalized = normalizeScannerVulnerability(match, 'grype')
        if (normalized) {
            vulnerabilities.push(normalized)
        }
    }

    return vulnerabilities
}

export function normalizeScannerVulnerability(
    raw: unknown,
    scanner: 'trivy' | 'grype'
): DockerVulnerabilityEntry | null {
    if (typeof raw !== 'object' || raw === null) {
        return null
    }

    const severity = normalizeSeverity(
        scanner === 'trivy'
            ? (raw as { Severity?: unknown }).Severity
            : (raw as { vulnerability?: { severity?: unknown } }).vulnerability
                  ?.severity
    )

    if (!severity) {
        return null
    }

    if (scanner === 'trivy') {
        const vulnerabilityId = nonEmptyString(
            (raw as { VulnerabilityID?: unknown }).VulnerabilityID
        )
        const packageName = nonEmptyString(
            (raw as { PkgName?: unknown }).PkgName
        )
        const installedVersion = nonEmptyString(
            (raw as { InstalledVersion?: unknown }).InstalledVersion
        )
        const fixedVersion = nonEmptyString(
            (raw as { FixedVersion?: unknown }).FixedVersion
        )
        const description =
            nonEmptyString((raw as { Description?: unknown }).Description) ??
            nonEmptyString((raw as { Title?: unknown }).Title) ??
            `${packageName ?? 'package'} vulnerability`
        const layerDigest = extractTrivyLayerDigest(raw)

        if (!vulnerabilityId || !packageName || !installedVersion) {
            return null
        }

        return {
            id: vulnerabilityId,
            severity,
            packageName,
            currentVersion: installedVersion,
            fixedVersion,
            description,
            layerId: layerDigest ?? undefined,
            layerDigest: layerDigest ?? undefined,
            scannerSources: [scanner],
        }
    }

    const vulnerability = (raw as { vulnerability?: unknown }).vulnerability
    const artifact = (raw as { artifact?: unknown }).artifact

    if (typeof vulnerability !== 'object' || vulnerability === null) {
        return null
    }

    const vulnerabilityId = nonEmptyString(
        (vulnerability as { id?: unknown }).id
    )
    const packageName =
        (typeof artifact === 'object' && artifact !== null
            ? nonEmptyString((artifact as { name?: unknown }).name)
            : null) ?? 'unknown-package'
    const installedVersion =
        (typeof artifact === 'object' && artifact !== null
            ? nonEmptyString((artifact as { version?: unknown }).version)
            : null) ?? 'unknown'

    if (!vulnerabilityId) {
        return null
    }

    const fix = (vulnerability as { fix?: unknown }).fix
    const fixedVersion =
        typeof fix === 'object' &&
        fix !== null &&
        Array.isArray((fix as { versions?: unknown }).versions)
            ? nonEmptyString((fix as { versions: unknown[] }).versions[0])
            : null

    const description =
        nonEmptyString(
            (vulnerability as { description?: unknown }).description
        ) ??
        nonEmptyString(
            (vulnerability as { dataSource?: unknown }).dataSource
        ) ??
        `${packageName} vulnerability`
    const layerDigest = extractGrypeLayerDigest(raw)

    return {
        id: vulnerabilityId,
        severity,
        packageName,
        currentVersion: installedVersion,
        fixedVersion,
        description,
        layerId: layerDigest ?? undefined,
        layerDigest: layerDigest ?? undefined,
        scannerSources: [scanner],
    }
}

export function mergeVulnerabilityEntries(
    entries: DockerVulnerabilityEntry[]
): DockerVulnerabilityEntry[] {
    const severityRank: Record<DockerVulnerabilityEntry['severity'], number> = {
        critical: 4,
        high: 3,
        medium: 2,
        low: 1,
    }

    const merged = new Map<string, DockerVulnerabilityEntry>()
    for (const entry of entries) {
        const key = `${entry.id}::${entry.packageName}::${entry.currentVersion}`
        const existing = merged.get(key)
        if (!existing) {
            merged.set(key, entry)
            continue
        }

        const scannerSources = [
            ...new Set([
                ...(existing.scannerSources ?? []),
                ...(entry.scannerSources ?? []),
            ]),
        ]

        const withSources = (
            source: DockerVulnerabilityEntry
        ): DockerVulnerabilityEntry => ({
            ...source,
            scannerSources,
        })

        if (severityRank[entry.severity] > severityRank[existing.severity]) {
            merged.set(key, withSources(entry))
            continue
        }

        const fixedVersion = existing.fixedVersion ?? entry.fixedVersion
        const description =
            existing.description.length >= entry.description.length
                ? existing.description
                : entry.description
        const layerDigest = existing.layerDigest ?? entry.layerDigest
        const layerId = existing.layerId ?? entry.layerId

        merged.set(
            key,
            withSources({
                ...existing,
                fixedVersion,
                description,
                layerDigest,
                layerId,
            })
        )
    }

    return [...merged.values()].sort(
        (a, b) => severityRank[b.severity] - severityRank[a.severity]
    )
}

export function normalizeSeverity(
    value: unknown
): DockerVulnerabilityEntry['severity'] | null {
    if (typeof value !== 'string') {
        return null
    }

    const normalized = value.trim().toLowerCase()
    if (
        normalized === 'critical' ||
        normalized === 'high' ||
        normalized === 'medium' ||
        normalized === 'low'
    ) {
        return normalized
    }

    return null
}

export function normalizeLayerDigest(value: unknown): string | null {
    const normalized = nonEmptyString(value)
    if (!normalized) {
        return null
    }

    return normalized.toLowerCase()
}

export function extractTrivyLayerDigest(raw: unknown): string | null {
    if (typeof raw !== 'object' || raw === null) {
        return null
    }

    const layer = (raw as { Layer?: unknown }).Layer
    if (typeof layer === 'string') {
        return normalizeLayerDigest(layer)
    }

    if (typeof layer === 'object' && layer !== null) {
        const layerCandidate =
            normalizeLayerDigest((layer as { DiffID?: unknown }).DiffID) ??
            normalizeLayerDigest((layer as { Digest?: unknown }).Digest) ??
            normalizeLayerDigest((layer as { LayerID?: unknown }).LayerID) ??
            normalizeLayerDigest((layer as { ID?: unknown }).ID)

        if (layerCandidate) {
            return layerCandidate
        }
    }

    return (
        normalizeLayerDigest((raw as { LayerID?: unknown }).LayerID) ??
        normalizeLayerDigest((raw as { LayerDigest?: unknown }).LayerDigest) ??
        null
    )
}

export function extractGrypeLayerDigest(raw: unknown): string | null {
    if (typeof raw !== 'object' || raw === null) {
        return null
    }

    const artifact = (raw as { artifact?: unknown }).artifact
    if (typeof artifact !== 'object' || artifact === null) {
        return null
    }

    const locations = Array.isArray(
        (artifact as { locations?: unknown }).locations
    )
        ? (artifact as { locations: unknown[] }).locations
        : []

    for (const location of locations) {
        if (typeof location !== 'object' || location === null) {
            continue
        }

        const digest =
            normalizeLayerDigest((location as { layerID?: unknown }).layerID) ??
            normalizeLayerDigest((location as { layerId?: unknown }).layerId) ??
            normalizeLayerDigest(
                (location as { layerDigest?: unknown }).layerDigest
            ) ??
            normalizeLayerDigest((location as { digest?: unknown }).digest)

        if (digest) {
            return digest
        }
    }

    return null
}

export function splitScannerOutputLines(output: string): string[] {
    return output
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
}

export function buildScanEvent(
    input: BuildScanEventInput
): DockerImageSecurityScanEvent {
    const base = {
        imageId: input.imageId,
        timestamp: new Date().toISOString(),
        stage: input.stage,
        scanner: input.scanner,
        message: input.message,
        progress: input.progress,
        logLine: input.logLine,
        scannerResult: input.scannerResult,
        scanSummary: input.scanSummary,
        vulnerabilities: input.vulnerabilities,
    } as const

    switch (input.type) {
        case 'status':
            return {
                ...base,
                type: 'status',
                payload: {
                    stage: input.stage,
                    progress: input.progress,
                    message: input.message,
                },
            }
        case 'log':
            return {
                ...base,
                type: 'log',
                payload: {
                    line: input.logLine ?? input.message,
                },
            }
        case 'result':
            return {
                ...base,
                type: 'result',
                payload: {
                    scannerResult: input.scannerResult ?? {
                        scanner: input.scanner ?? 'trivy',
                        status: 'unavailable',
                        findingsCount: 0,
                        durationMs: null,
                        executedAt: new Date().toISOString(),
                        error: null,
                    },
                },
            }
        case 'complete':
            return {
                ...base,
                type: 'complete',
                payload: {
                    scanSummary: input.scanSummary ?? {
                        cached: false,
                        scannedAt: new Date().toISOString(),
                        totalFindings: input.vulnerabilities?.length ?? 0,
                        scanners: input.scannerResult
                            ? [input.scannerResult]
                            : [],
                        layerEfficiency: null,
                    },
                    vulnerabilities: input.vulnerabilities ?? [],
                },
            }
        case 'error':
            return {
                ...base,
                type: 'error',
                payload: {
                    error: input.logLine ?? input.message,
                    scannerResult: input.scannerResult ?? null,
                },
            }
    }
}

export function parseDiveLayerEfficiency(
    output: string
): DockerImageLayerEfficiency | null {
    const normalizedOutput = output.trim()
    if (normalizedOutput.length === 0) {
        return null
    }

    const efficiencyMatch =
        /(?:image\s+efficiency\s+score|efficiency(?:\s+score)?)\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\s*%?/iu.exec(
            normalizedOutput
        )
    const wastedPercentMatch =
        /(?:wasted\s+space|wasted)\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\s*%/iu.exec(
            normalizedOutput
        )
    const wastedSizeMatch =
        /(?:potential\s+wasted\s+space|wasted\s+bytes?)\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\s*([kmgtep]?i?b)/iu.exec(
            normalizedOutput
        )

    const efficiencyScore = efficiencyMatch ? Number(efficiencyMatch[1]) : null
    const estimatedWastedPercent = wastedPercentMatch
        ? Number(wastedPercentMatch[1])
        : null
    const estimatedWastedBytes =
        wastedSizeMatch?.[1] && wastedSizeMatch[2]
            ? parseByteValue(wastedSizeMatch[1], wastedSizeMatch[2])
            : null

    const notes = normalizedOutput
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .filter((line) => /efficiency|wasted|layer/iu.test(line))
        .slice(0, 4)

    if (
        efficiencyScore === null &&
        estimatedWastedPercent === null &&
        estimatedWastedBytes === null &&
        notes.length === 0
    ) {
        return null
    }

    return {
        efficiencyScore,
        estimatedWastedPercent,
        estimatedWastedBytes,
        notes,
    }
}

export function parseByteValue(
    rawValue: string,
    rawUnit: string
): number | null {
    const value = Number(rawValue)
    if (Number.isNaN(value) || value < 0) {
        return null
    }

    const unit = rawUnit.trim().toLowerCase()
    const multipliers: Record<string, number> = {
        b: 1,
        kb: 1_000,
        mb: 1_000_000,
        gb: 1_000_000_000,
        tb: 1_000_000_000_000,
        pb: 1_000_000_000_000_000,
        kib: 1_024,
        mib: 1_048_576,
        gib: 1_073_741_824,
        tib: 1_099_511_627_776,
        pib: 1_125_899_906_842_624,
    }

    const multiplier = multipliers[unit]
    if (!multiplier) {
        return null
    }

    return Math.round(value * multiplier)
}

/** Starts (or reuses) the shared scanner container for `scanner`; resolves to whether it is running. */
