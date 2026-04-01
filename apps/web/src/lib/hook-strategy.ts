/**
 * Domain Hook Export Strategy
 *
 * Provides conditional exports based on data mode (mock vs live).
 * Pages can use: `import { useOrganizations } from '@/domains/organization/hooks'`
 * And automatically get mock or live hooks based on NEXT_PUBLIC_DATA_MODE.
 */

export function createConditionalHookExports<T extends Record<string, any>>(
  liveHooks: T,
  mockHooks: T,
  dataMode: 'mock' | 'live',
): T {
  if (dataMode === 'mock') {
    return mockHooks
  }
  return liveHooks
}
