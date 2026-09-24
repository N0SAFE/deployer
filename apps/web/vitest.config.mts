/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import * as path from 'path'
import { createNextJsConfig } from '@repo/config-vitest'

const shared = createNextJsConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '#': path.resolve(__dirname, './'),
            '~': path.resolve(__dirname, './'),
            // Workspace packages resolve to their `src` **directory**, not to a
            // single `index.ts` file. Code imports deep subpaths such as
            // `@repo/orpc-utils/builder/core/route-builder`; mapping the package
            // name to a directory lets both the barrel and every subpath resolve
            // to source. Mapping to `${pkg}/src/index.ts` would leave subpaths to
            // fall through to `dist/`, which tests must not load.
            '@repo/env': path.resolve(__dirname, '../../packages/utils/env/src'),
            '@repo/logger': path.resolve(__dirname, '../../packages/utils/logger/src'),
            '@repo/type-guards': path.resolve(__dirname, '../../packages/utils/type-guards/src'),
            '@repo/api-contracts': path.resolve(__dirname, '../../packages/contracts/api'),
            '@repo/auth': path.resolve(__dirname, '../../packages/utils/auth/src'),
            '@repo/contracts-entities': path.resolve(__dirname, '../../packages/contracts/entities/src'),
            '@repo/contracts-common': path.resolve(__dirname, '../../packages/contracts/common/src'),
            '@repo/orpc-utils': path.resolve(__dirname, '../../packages/utils/orpc/src'),
            '@repo/provider-schema': path.resolve(__dirname, '../../packages/utils/provider-schema/src'),
            '@repo/errors': path.resolve(__dirname, '../../packages/utils/errors/src'),
            '@repo/nest-events': path.resolve(__dirname, '../../packages/nest/events/src'),
            '@repo/nest-lifecycle': path.resolve(__dirname, '../../packages/nest/lifecycle/src'),
            '@repo/ui': path.resolve(__dirname, '../../packages/ui/base/src'),
            '@repo/types': path.resolve(__dirname, '../../packages/types/src'),
            '@repo': path.resolve(__dirname, '../../packages'),
        },
    },
    define: {
        // Mock Next.js env variables
        'process.env.NODE_ENV': '"test"',
        'process.env.NEXT_PUBLIC_API_URL': '"http://localhost:3001"',
        'process.env.NEXT_PUBLIC_DOC_URL': '"http://localhost:3020"',
    },
})

export default defineConfig({
    ...shared,
    test: {
        // ── Top level: used by the ROOT workspace run only. ──
        // The root `vitest.config.mts` lists this file through
        // `projects: ["apps/**/vitest.config.mts"]`, which makes Vitest treat
        // this config as ONE project and IGNORE the `projects` array below.
        // Without these defaults that run has no jsdom environment and every
        // component test fails with `document is not defined`.
        environment: 'jsdom',
        setupFiles: ['./vitest.setup.unit.ts'],
        globals: true,
        include: [
            'src/**/*.test.{ts,tsx,js,jsx}',
            'src/**/*.spec.{ts,tsx,js,jsx}',
            'src/**/__tests__/**/*.{ts,tsx,js,jsx}',
        ],
        exclude: [
            'node_modules',
            'dist',
            '.next',
            'src/**/*.e2e.spec.{ts,tsx}',
        ],
        // ── Projects: used by the standalone run (`cd apps/web`). ──
        // Each project spreads `shared` (so it keeps the resolve aliases and
        // the React plugin) and then declares its ENTIRE `test` block.
        //
        // Do NOT use `extends: true` here. It CONCATENATES array options
        // (`include`, `exclude`, `setupFiles`) with the top-level ones instead
        // of replacing them, and re-declaring them does not override that:
        // `vitest list --project e2e` showed the node-environment `e2e` project
        // still claiming 29 unit specs (e.g.
        // `src/utils/__tests__/tanstack-query.test.tsx`), which then failed with
        // `window is not defined` inside the test body. Spreading + replacing
        // keeps the two environments strictly apart.
        projects: [
            {
                ...shared,
                test: {
                    name: 'unit',
                    environment: 'jsdom',
                    globals: true,
                    setupFiles: ['./vitest.setup.unit.ts'],
                    testTimeout: 10000, // 10 seconds timeout
                    include: [
                        'src/**/*.test.{ts,tsx,js,jsx}',
                        'src/**/*.spec.{ts,tsx,js,jsx}',
                        'src/**/__tests__/**/*.{ts,tsx,js,jsx}',
                    ],
                    exclude: [
                        'node_modules',
                        'dist',
                        '.next',
                        'src/**/*.e2e.spec.{ts,tsx}',
                    ],
                    // Mock Next.js modules
                    server: {
                        deps: {
                            inline: ['next', '@next/font'],
                        },
                    },
                },
            },
            {
                ...shared,
                test: {
                    name: 'e2e',
                    environment: 'node',
                    globals: true,
                    setupFiles: ['./vitest.setup.e2e.ts'],
                    globalSetup: ['./vitest.global-setup.e2e.ts'],
                    include: ['src/**/*.e2e.spec.{ts,tsx}'],
                    exclude: ['node_modules', 'dist', '.next'],
                    // The production server start + first HTML render can be slow.
                    testTimeout: 30_000,
                    hookTimeout: 60_000,
                    // One worker: all specs share the same server instance.
                    fileParallelism: false,
                },
            },
        ],
    },
})
