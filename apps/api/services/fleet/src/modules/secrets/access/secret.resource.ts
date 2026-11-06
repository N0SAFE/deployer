import { defineResource } from '@deployer/nest-effect'

/** The platform's secrets as a thing access is asked about. Platform-wide: a secret belongs to the platform, not a project. */
export const PlatformSecretResource = defineResource('platform.secret', {
    scope: 'platform',
})
