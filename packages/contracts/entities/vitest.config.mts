/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import { createNodeConfig } from '@repo/config-vitest/node'

export default defineConfig(
  createNodeConfig({
    test: {
      globals: true,
      environment: 'node',
      include: ['src/__tests__/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
      exclude: ['**/node_modules/**', '**/dist/**'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        reportsDirectory: './coverage',
        clean: true,
      },
    },
    resolve: {
      alias: {
        '@': './src',
        '~': './',
      },
    },
  })
)
