import { describe, expect, it } from 'vitest'
import {
  computeServiceDepths,
  isDependencyEnabledInEnvironment,
  isServiceInEnvironment,
  resolveTargetEnvironment,
} from './graph-env'

describe('graph-env', () => {
  it('treats a dependency without enabledIn as enabled everywhere, preview/* matching preview', () => {
    const dep = { id: 'd', serviceId: 'a', dependsOnServiceId: 'b', isRequired: true }
    expect(isDependencyEnabledInEnvironment(dep, 'production')).toBe(true)
    expect(isDependencyEnabledInEnvironment({ ...dep, enabledIn: ['preview'] }, 'preview/pr-1')).toBe(true)
    expect(isDependencyEnabledInEnvironment({ ...dep, enabledIn: ['staging'] }, 'production')).toBe(false)
  })

  it('matches preview lanes for services scoped to preview', () => {
    expect(isServiceInEnvironment(['preview'], 'preview/pr-1')).toBe(true)
    expect(isServiceInEnvironment(['production'], 'preview/pr-1')).toBe(false)
  })

  it('resolves the target environment with sensible fallbacks', () => {
    expect(resolveTargetEnvironment('staging', [])).toBeNull()
    expect(resolveTargetEnvironment('staging', ['production', 'staging'])).toBe('staging')
    expect(resolveTargetEnvironment('preview/pr-1', ['production', 'preview'])).toBe('preview')
    expect(resolveTargetEnvironment('development', ['production'], 'staging')).toBe('production')
  })

  it('computes depths and survives cycles', () => {
    const depths = computeServiceDepths(['a', 'b', 'c'], new Map([['a', ['b']], ['b', ['c']], ['c', []]]))
    expect(depths.get('a')).toBe(2)
    expect(depths.get('c')).toBe(0)
    expect(() => computeServiceDepths(['x', 'y'], new Map([['x', ['y']], ['y', ['x']]]))).not.toThrow()
  })
})
