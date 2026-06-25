import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        name: 'use-safe-query-param-states-from-zod',
        environment: 'node',
        globals: false,
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        server: {
            deps: {
                inline: ['zod'],
            },
        },
        deps: {
            optimizer: {
                web: {
                    include: ['zod'],
                },
            },
        },
    },
})
