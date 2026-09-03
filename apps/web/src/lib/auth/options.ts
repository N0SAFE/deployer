import { createAuthClientFactory } from '@repo/auth/client'
import { getBaseApiUrl } from '../api-url'

// Explicit `ReturnType` annotation: the factory's inferred return type
// references internal builder types (RolesAsRoleObjects) that tsgo cannot
// serialize portably for an exported symbol (TS2883).
export const authClient: ReturnType<typeof createAuthClientFactory> = createAuthClientFactory({
    basePath: '/api/auth',
    baseURL: getBaseApiUrl(),
    fetchOptions: {
        credentials: 'include',
    },
})
