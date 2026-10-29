import { defineConfig } from 'vitest/config';

/**
 * The package's own test project.
 *
 * `globals: true` matches every other package here, so a spec does not import
 * `describe`/`it`/`expect` — one convention across the repo rather than one per
 * package. `environment: 'node'` because this is transport and reflection code with
 * no DOM in it.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
