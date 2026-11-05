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
    // Controllers must go through `procedure()` so the authz gate is always applied (`SEC-062`).
    {
        extends: [nestjsConfig.configs.controllersUseProcedure()],
    },
])
