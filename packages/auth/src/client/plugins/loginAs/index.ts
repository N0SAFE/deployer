import type { BetterAuthClientPlugin } from "better-auth"

export const loginAsClientPlugin = () => {
    return {
        id: 'login-as',
        $InferServerPlugin: {} as ReturnType<typeof import('@deployer/auth/server/plugins/loginAs').loginAsPlugin>,
    } satisfies BetterAuthClientPlugin
}