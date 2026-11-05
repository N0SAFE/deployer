import libraryConfig from '@deployer/config-eslint/library'
import nestjsConfig from '@deployer/config-eslint/nestjs'
import { defineConfig } from '@deployer/config-eslint'

export default defineConfig([
    // Every Nest role the Effect + oRPC integration replaces is banned (docs/architecture/effect-orpc-conventions.md), file by file:
    // `nest-roles.ledger.json` lists the files that have not migrated yet. Delete an entry when its file migrates.
    {
        extends: [
            nestjsConfig.configs.nestRoles({
                ledger: `${import.meta.dirname}/nest-roles.ledger.json`,
            }),
        ],
    },
    {
        extends: [libraryConfig.configs.base()],
        files: ['src/**/*.{ts,tsx}'],
        rules: {
            '@typescript-eslint/no-extraneous-class': 'off',
        },
    },
    // This service may only import the schema tables it owns. Ownership is the
    // directory: `@deployer/nest-schema/global/runtime/` (plus the shared `platform`
    // and `utils` directories). The union barrel is banned.
    {
        extends: [
            nestjsConfig.configs.serviceSchemaBoundary({ owner: 'runtime' }),
        ],
    },
    // Controllers must go through `procedure()` so the authz gate is always applied (`SEC-062`).
    {
        extends: [nestjsConfig.configs.controllersUseProcedure()],
    },
    {
        extends: [libraryConfig.configs.test()],
        files: ['**/*.spec.{ts,tsx}', '**/*.test.{ts,tsx}'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
        },
    },
])
