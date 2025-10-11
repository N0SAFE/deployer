// middleware.ts

import { stackMiddlewares } from './middlewares/utils/stackMiddlewares'
import { withHeaders } from './middlewares/WithHeaders'
import * as HealthCheckMiddleware from './middlewares/WithHealthCheck' // Temporarily disabled for performance
import * as AuthMiddleware from './middlewares/WithAuth'
import * as EnvMiddleware from './middlewares/WithEnv'
import * as SetupMiddleware from './middlewares/WithSetup'
import * as OrganizationMiddleware from './middlewares/WithOrganization'
import * as WithRedirect from "./middlewares/WithRedirect";
import { Middleware } from './middlewares/utils/types'

const middlewares = [
    EnvMiddleware,
    // HealthCheckMiddleware, // Temporarily disabled - this was adding significant latency to every page load
    SetupMiddleware, // Check for initial setup before auth
    WithRedirect,
    AuthMiddleware,
    OrganizationMiddleware, // Check for active organization after auth
    withHeaders,
] satisfies Middleware[]

export default stackMiddlewares(middlewares)
