import { describe, expect, it } from 'vitest'
import type { DockerVulnerabilityEntry } from '@deployer/contracts-entities'
import {
  buildLayerRiskById,
  filterAndSortVulnerabilities,
  summarizeSeverity,
} from './scan-model'
import { parsePullLayerActivity } from './pull-layer-model'

function vuln(partial: Partial<DockerVulnerabilityEntry> & Pick<DockerVulnerabilityEntry, 'id' | 'severity'>): DockerVulnerabilityEntry {
  return {
    packageName: 'openssl',
    currentVersion: '1.0',
    fixedVersion: null,
    description: 'desc',
    ...partial,
  }
}

describe('scan-model', () => {
  it('parses a pull layer line and strips ansi', () => {
    expect(parsePullLayerActivity('\u001b[0m1a2b3c: Downloading 42%')).toMatchObject({
      layerId: '1a2b3c',
      status: 'downloading',
      progress: 42,
    })
    expect(parsePullLayerActivity('not a layer line')).toBeNull()
  })

  it('counts severities', () => {
    const counts = summarizeSeverity([vuln({ id: 'a', severity: 'high' }), vuln({ id: 'b', severity: 'high' }), vuln({ id: 'c', severity: 'low' })])
    expect(counts).toEqual({ critical: 0, high: 2, medium: 0, low: 1 })
  })

  it('filters and sorts findings', () => {
    const rows = [
      vuln({ id: 'CVE-1', severity: 'low', packageName: 'zlib' }),
      vuln({ id: 'CVE-2', severity: 'critical', packageName: 'curl', layerId: 'sha256:abc' }),
    ]
    const base = { search: '', severity: 'all', scanner: 'all', sort: 'severity-desc' } as const
    expect(filterAndSortVulnerabilities(rows, base).map((r) => r.id)).toEqual(['CVE-2', 'CVE-1'])
    expect(filterAndSortVulnerabilities(rows, { ...base, scanner: 'unmapped' }).map((r) => r.id)).toEqual(['CVE-1'])
    expect(filterAndSortVulnerabilities(rows, { ...base, search: 'curl' }).map((r) => r.id)).toEqual(['CVE-2'])
  })

  it('maps findings to layers by normalized digest', () => {
    const map = buildLayerRiskById([{ id: 'sha256:ABC' }], [vuln({ id: 'CVE-2', severity: 'high', layerDigest: 'abc' })])
    expect(map.get('sha256:ABC')?.findings).toHaveLength(1)
    expect(map.get('sha256:ABC')?.severity).toBe('high')
  })
})
