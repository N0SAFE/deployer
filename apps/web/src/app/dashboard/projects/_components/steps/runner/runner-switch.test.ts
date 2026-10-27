import { describe, expect, it } from 'vitest'
import { configForRunnerSwitch } from './runner-switch'

describe('configForRunnerSwitch', () => {
  it('returns null when re-selecting the current runner', () => {
    expect(configForRunnerSwitch('manual', {}, 'manual', [])).toBeNull()
  })

  it('uses runner defaults for unrelated switches', () => {
    const cfg = configForRunnerSwitch('manual', { startCommand: 'x' }, 'static', []) as Record<string, unknown>
    expect(cfg.outputDir).toBeDefined()
  })

  it('compose -> sub-services falls back to declared services when nothing was detected', () => {
    const cfg = configForRunnerSwitch(
      'compose',
      { composeFile: 'compose.yml', profiles: ['p'], declaredServices: [{ name: 'db', image: 'postgres:16', ports: ['5432'] }] },
      'orchestrator',
      [],
    ) as Record<string, unknown>
    expect(cfg.composeFile).toBe('compose.yml')
    expect(cfg.profiles).toEqual(['p'])
    const subs = cfg.subServices as { name: string; image: string; ports: number[]; visibility: string }[]
    expect(subs).toHaveLength(1)
    expect(subs[0]).toMatchObject({ name: 'db', image: 'postgres:16', ports: [5432], visibility: 'public' })
  })

  it('sub-services -> compose flattens the sub-services into declared services', () => {
    const cfg = configForRunnerSwitch(
      'orchestrator',
      { composeProjectName: 'shop', subServices: [{ name: 'web', image: 'nginx', ports: [80] }] },
      'compose',
      [],
    ) as Record<string, unknown>
    expect(cfg.appName).toBe('shop')
    expect(cfg.composeFile).toBe('docker-compose.yml')
    expect(cfg.declaredServices).toEqual([{ name: 'web', image: 'nginx', ports: ['80'] }])
  })
})
