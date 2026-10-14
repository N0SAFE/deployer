import { build } from '@deployer/pkg-build/config'

/** Build configuration for `@deployer/nest-schema`. */
export default build({
    target: 'node',
    root: 'src',
    copy: [
        {
            from: 'migrations',
            to: 'dist/migrations',
        },
    ],
})
