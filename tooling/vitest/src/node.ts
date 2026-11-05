/// <reference types="vitest" />
import { ViteUserConfigExport } from 'vitest/config'
import { createBaseConfig } from './base.js'

/**
 * Node.js-specific Vitest configuration
 *
 * ── WHY `...overrides` STILL WINS WHOLESALE HERE ─────────────────────────────
 * Merging this `test` block per key would push `setupFiles:
 * ['./vitest.setup.node.js']` into every consumer that passes its own `test`
 * (every service app does, through `createServiceTestConfig`). That path resolves
 * relative to the consumer's directory, where no such file exists, so each of them
 * would fail at startup. The worker cap does not need to travel through here:
 * `createBaseConfig` applies it after merging, and no consumer sets `maxWorkers`.
 */
export const createNodeConfig = (overrides: ViteUserConfigExport = {}): ViteUserConfigExport => {
  const baseConfig = createBaseConfig({
    test: {
      environment: 'node',
      setupFiles: ['./vitest.setup.node.js'],
      globals: true,
    },
    ...overrides,
  })

  return baseConfig
}

export const defaultConfig = createNodeConfig()

export default defaultConfig
