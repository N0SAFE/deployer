import type { impersonationPlugin } from '../../server/plugins/impersonation'

/**
 * Links the client to `impersonationPlugin`.
 *
 * `$InferServerPlugin` is what turns the plugin's `impersonate` / `stopImpersonating` endpoints into typed client
 * methods, without the client re-declaring their input or output.
 */
export const impersonationClient = () => ({
    id: 'impersonation' as const,
    $InferServerPlugin: {} as ReturnType<typeof impersonationPlugin>,
})
