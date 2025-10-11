import { ClientOptions } from 'better-auth'
import masterTokenClient from './plugins/masterToken'
import { loginAsClientPlugin } from './plugins/loginAs'
import { passkeyClient } from 'better-auth/client/plugins'
import { organizationClient } from 'better-auth/client/plugins'
import { nextCookies } from 'better-auth/next-js'
import { validateEnvPath } from '#/env'

const appUrl = validateEnvPath(
    process.env.NEXT_PUBLIC_APP_URL!,
    'NEXT_PUBLIC_APP_URL'
)

export const options = {
    basePath: '/api/auth',
    baseURL: appUrl,
    plugins: [
        passkeyClient(),
        organizationClient({
            teams: {
                enabled: true,
            },
        }),
        masterTokenClient(),
        loginAsClientPlugin(),
        nextCookies(),
    ],
} as const satisfies ClientOptions
