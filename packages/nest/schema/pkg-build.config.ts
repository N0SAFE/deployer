import { defineConfig } from '@deployer/pkg-build/config'

/** Build configuration for `@deployer/nest-schema`. */
export default defineConfig({
    target: 'node',
    root: 'src',
    copy: [
        {
            from: 'migrations',
            to: 'dist/migrations',
        },
    ],
})
