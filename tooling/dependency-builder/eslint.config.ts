import { defineConfig } from '@deployer/config-eslint'
import nestjsConfig from '@deployer/config-eslint/nestjs'

export default defineConfig([
    {
        extends: [nestjsConfig.configs.base()],
        files: ['src/**/*'],
        ignores: ['**/*.spec.ts', '**/*.test.ts'],
    },
    {
        extends: [nestjsConfig.configs.test()],
        files: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    },
])
