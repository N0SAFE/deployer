import { createAuthClient } from 'better-auth/react'
import type { BetterAuthClientOptions, BetterAuthClientPlugin } from 'better-auth/client'
import { inferAdditionalFields } from 'better-auth/client/plugins'
import type { betterAuthFactory } from '../server/index'
import {
    masterTokenClient,
    loginAsClientPlugin,
    useInviteClient,
    useAdminClient,
    useOrganizationClient,
} from './plugins'

// Extract the actual auth type from the factory return type
type AuthInstance = ReturnType<typeof betterAuthFactory>['auth']

export type CreateAuthClientFactoryOptions = Pick<BetterAuthClientOptions, 'basePath' | 'baseURL' | "fetchOptions"> & { additionalPlugins?: BetterAuthClientOptions['plugins'] }

/**
 * Factory function to create a Better Auth client with default plugins
 * and support for additional plugins
 */
export const createAuthClientFactory = <Options extends CreateAuthClientFactoryOptions>(options: Options) => {
  const {
    basePath = '/api/auth',
    baseURL,
    additionalPlugins = [],
    fetchOptions = {
      credentials: 'include',
    },
  } = options

  const clientOptions = {
    basePath,
    baseURL,
    fetchOptions,
    plugins: [
      masterTokenClient(),
      loginAsClientPlugin(),
      useInviteClient(),
      useAdminClient(),
      useOrganizationClient(),
      inferAdditionalFields<AuthInstance>(),
      ...additionalPlugins as Options['additionalPlugins'] & [],
    ],
  } satisfies BetterAuthClientOptions

  return createAuthClient(clientOptions)
}
