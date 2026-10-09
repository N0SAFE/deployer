import { describe, expect, it } from 'vitest'
import { buildTriggerSource } from '../trigger-source'

describe('buildTriggerSource', () => {
  it('uses repository and branch for git providers', () => {
    expect(buildTriggerSource('github', { sourceUrl: 'https://github.com/a/b', branch: 'dev' })).toEqual({
      sourceType: 'github', repositoryUrl: 'https://github.com/a/b', branch: 'dev',
    })
    expect(buildTriggerSource('gitlab', { repositoryUrl: 'https://gitlab.com/a/b' })).toEqual({
      sourceType: 'gitlab', repositoryUrl: 'https://gitlab.com/a/b', branch: 'main',
    })
  })
  it('falls back to custom without a repository or for other providers', () => {
    expect(buildTriggerSource('github', {})).toEqual({ sourceType: 'custom' })
    expect(buildTriggerSource('manual', null)).toEqual({ sourceType: 'custom' })
  })
})
