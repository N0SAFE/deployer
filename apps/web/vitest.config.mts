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
            '@repo/env': path.resolve(__dirname, '../../packages/utils/env/src/index.ts'),
            '@repo/logger': path.resolve(__dirname, '../../packages/utils/logger/src/index.ts'),
            '@repo/type-guards': path.resolve(__dirname, '../../packages/utils/type-guards/src/index.ts'),
            '@repo/api-contracts': path.resolve(__dirname, '../../packages/contracts/api/index.ts'),
            '@repo/auth': path.resolve(__dirname, '../../packages/utils/auth/src'),
            '@repo/contracts-entities': path.resolve(__dirname, '../../packages/contracts/entities/src/index.ts'),
            '@repo/contracts-common': path.resolve(__dirname, '../../packages/contracts/common/src/index.ts'),
            '@repo/orpc-utils': path.resolve(__dirname, '../../packages/utils/orpc/src/index.ts'),
            '@repo/ui': path.resolve(__dirname, '../../packages/ui/base/src'),
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
        // Default environment for root vitest workspace (which doesn't resolve
        // nested projects). When running standalone from apps/web, the nested
        // `projects` array below handles unit (jsdom) vs e2e (node) properly.
        environment: 'jsdom',
        setupFiles: ['./vitest.setup.ts'],
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
        // Projects split (same pattern as apps/api): fast jsdom unit tests by
        // default (`test`), real-server e2e behind `test:e2e`.
        projects: [
            {
                extends: true,
                test: {
                    name: 'unit',
                    environment: 'jsdom',
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
                    setupFiles: ['./vitest.setup.ts'],
                    globals: true,
                    // Mock Next.js modules
                    server: {
                        deps: {
                            inline: ['next', '@next/font'],
                        },
                    },
                },
            },
            {
                extends: true,
                test: {
                    name: 'e2e',
                    environment: 'node',
                    include: ['src/**/*.e2e.spec.{ts,tsx}'],
                    exclude: ['node_modules', 'dist', '.next'],
                    globalSetup: ['./vitest.global-setup.e2e.ts'],
                    setupFiles: ['./vitest.setup.e2e.ts'],
                    globals: true,
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
