import { build } from '@deployer/pkg-build/config'

/** Build configuration for `@deployer/project-contracts`. */
export default build({
    root: '.',
    entries: ['index.ts'],
    formats: ['esm'],
    flat: true,
    target: 'bun',
    minify: true,
    external: ['@orpc/contract', '@orpc/shared', 'zod'],
})
