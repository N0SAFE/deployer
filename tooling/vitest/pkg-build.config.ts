import { build } from '@deployer/pkg-build/config'

/** Build configuration for `@deployer/config-vitest`. */
export default build({
    root: 'src',
    formats: ['esm', 'cjs'],
})
