import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (pkg: string) => fileURLToPath(new URL(`../${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Cross-package imports resolve to source so tests never depend on a prior `build:types`.
    alias: {
      '@deployer/effect-core': src('core'),
      '@deployer/effect-infra': src('infra'),
    },
  },
  test: {
    name: 'effect-core',
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
