import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Internal packages are consumed from SOURCE so a change in a sibling
      // package is picked up without a build step, matching the other
      // packages under packages/nest.
      '@repo/nest-docker/services/docker.service': path.resolve(__dirname, '../docker/src/services/docker.service.ts'),
      '@repo/nest-docker/docker-config': path.resolve(__dirname, '../docker/src/docker-config.ts'),
      '@repo/nest-nodes/cluster-node.repository': path.resolve(__dirname, '../nodes/src/cluster-node.repository.ts'),
      '@repo/nest-nodes/swarm-node-labels': path.resolve(__dirname, '../nodes/src/swarm-node-labels.ts'),
      '@repo/nest-schema/local': path.resolve(__dirname, '../schema/src/local/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
