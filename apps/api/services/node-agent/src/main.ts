import 'reflect-metadata'
import '@orpc/effect/extensions/effect'
// The oRPC context augmentation (`context.request`, `context.auth`), imported for its side effect and as
// `@deployer/shared/core/...` so it is the SAME module identity the shared code resolves.
import '@deployer/shared/core/orpc/context'

import { apiServicePort } from '@deployer/env'
import { logger } from '@deployer/logger'
import { assertRequirementsMet } from '@deployer/nest-effect'
import {
    DEPENDENCIES,
    DependencyNotReadyError,
    bootstrapApiServer,
} from '@deployer/shared/server'

import { NodeAgentServiceModule } from './app.module'
import { productionImageWarning } from './config/node-agent.env'

/** The port comes from the shared catalog, so the agent listens where everything else addresses it. */
const PORT = apiServicePort('node-agent')
const NAME = 'svc-node-agent'

/**
 * The interface to bind: unset binds every interface, which is what a node whose peers reach it by any address needs.
 * A deployment that knows its node's LAN/overlay address pins the door to it.
 */
const BIND_ADDRESS = process.env.NODE_AGENT_BIND_ADDRESS ?? ''

/**
 * An agent declares no dependency to prove: it needs neither a database nor Redis, and requiring one would make it
 * un-startable on a node that is not in a swarm yet.
 */
/**
 * The strict requirement gate: the root only compiles when every `[controller, services]` pair forwarded from a domain
 * module is resolved. The mesh providers are not controllers, so the transport resolver's contract check is their gate.
 */
const rootModule = assertRequirementsMet(NodeAgentServiceModule)

const imageWarning = productionImageWarning({
    NODE_ENV: process.env.NODE_ENV,
    NODE_AGENT_IMAGE: process.env.NODE_AGENT_IMAGE,
})
if (imageWarning !== null) logger.scope(NAME).warn(imageWarning)

// The transport is a module: binding the port is all this file does, and Nest's shutdown path stops the websocket, the
// local socket and the loops.
void bootstrapApiServer({
    rootModule,
    port: PORT,
    host: BIND_ADDRESS === '' ? undefined : BIND_ADDRESS,
    name: NAME,
    dependencies: DEPENDENCIES.none,
}).catch((error: unknown) => {
    if (error instanceof DependencyNotReadyError) {
        console.error(error.message)
        process.exit(5)
    }
    console.error(error)
    process.exit(1)
})
