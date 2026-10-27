import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Consume the protocol package from SOURCE so a change there is tested here
      // without a build step.
      '@deployer/mesh-network': path.resolve(import.meta.dirname, '../../packages/infrastructure/mesh-network/src/index.ts'),
    },
  },
  test: {
    name: 'mesh-agent',
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
