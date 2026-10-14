import { build } from '@deployer/pkg-build/config'

/** Build configuration for `@deployer/ui`. */
export default build({
    root: 'src',
    entries: ['index.ts'],
    include: ['components', 'hooks', 'lib'],
    variants: ['development', 'production'],
    copy: [
        {
            from: 'src/styles',
            to: 'dist/styles',
        },
    ],
})
