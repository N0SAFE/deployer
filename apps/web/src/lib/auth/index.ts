import { validateEnvPath } from "#/env"
import { createAuthClient } from "better-auth/react"
import { passkeyClient } from "better-auth/client/plugins"
import { organizationClient } from "better-auth/client/plugins"

const appUrl = validateEnvPath(process.env.NEXT_PUBLIC_APP_URL!, "NEXT_PUBLIC_APP_URL")

export const authClient = createAuthClient({
  basePath: '/api/auth',
  baseURL: appUrl,
  plugins: [
    passkeyClient(),
    organizationClient({
      teams: {
        enabled: true
      }
    }),
  ],
})

export const {
  signIn,
  signOut,
  signUp,
  useSession,
  getSession,
  $store,
  $fetch,
  $ERROR_CODES,
  $Infer,
  organization
} = authClient

// Auth pages configuration for Better Auth
export const pages = {
    signIn: '/auth/login',
    signOut: '/auth/logout',
    error: '/auth/error',
} as const
