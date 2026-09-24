import type { BetterAuthClientPlugin } from "better-auth"

export const loginAsClientPlugin = () => {
    return {
        id: 'login-as',
        $InferServerPlugin: {} as ReturnType<typeof import('@repo/auth/server/plugins/loginAs').loginAsPlugin>,
    } satisfies BetterAuthClientPlugin
}