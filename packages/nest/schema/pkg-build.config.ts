import { defineConfig } from '@repo/pkg-build/config'

/** Build configuration for `@repo/nest-schema`. */
export default defineConfig({
    root: 'src',
    copy: [
        {
            from: 'migrations',
            to: 'dist/migrations',
        },
    ],
})
