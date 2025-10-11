import { defineConfig } from 'vitest/config';

// Import createNodeConfig from CJS export; TypeScript may not infer types from subpath properly in Docker context
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createNodeConfig } = require('@repo/vitest-config/node')

export default defineConfig(
  createNodeConfig({
    test: {
      globals: true,
      environment: 'node',
      include: ['src/**/*.{test,spec}.{js,ts}', 'test/**/*.{test,spec}.{js,ts}'],
      exclude: ['node_modules', 'dist'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: [
          'node_modules/',
          'dist/',
          'test/',
          'src/types/',
          '**/*.d.ts',
          '**/*.test.ts',
          '**/*.spec.ts'
        ],
        thresholds: {
          global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80
          }
        }
      },
      testTimeout: 10000,
      hookTimeout: 10000
    },
    resolve: {
      alias: {
        '@': './src',
        '@test': './test'
      }
    }
  })
);
