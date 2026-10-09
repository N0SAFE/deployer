import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'mesh-network',
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
