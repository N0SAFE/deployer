import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (pkg: string) => fileURLToPath(new URL(`../${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Cross-package imports resolve to source so tests never depend on a prior `build:types`.
    // `effect` is pinned to ONE copy on purpose: the isolated linker gives every workspace
    // its own node_modules, so an aliased-from-source package would otherwise load a SECOND
    // copy of the runtime — two `Layer`/`Context` classes — and a layer built by one copy
    // cannot be provided to an effect from the other ("self.build is not a function").
    alias: {
      '@deployer/effect-core': src('core'),
      '@deployer/effect-infra': src('infra'),
      effect: fileURLToPath(new URL('./node_modules/effect', import.meta.url)),
    },
  },
  test: {
    name: 'effect-reachability',
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
