import type { deployerUserSchemaPlugin } from '../../server/plugins/schema'

/**
 * Links the client to the server's `deployerUserSchemaPlugin`.
 *
 * `$InferServerPlugin` is how Better Auth carries a server plugin's `schema` into the CLIENT session type (two-factor's
 * client plugin does the same). Without it the fields exist on the server and are invisible to `authClient`'s session.
 */
export const deployerUserSchemaClient = () => ({
    id: 'deployer-user-schema' as const,
    $InferServerPlugin: {} as ReturnType<typeof deployerUserSchemaPlugin>,
})
