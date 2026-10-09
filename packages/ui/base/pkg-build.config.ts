import { defineConfig } from '@repo/pkg-build/config'

/** Build configuration for `@repo/ui`. */
export default defineConfig({
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
