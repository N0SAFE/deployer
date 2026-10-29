import { Layer } from 'effect'

import { RuntimeDb } from "./core/database/runtime-db";

/**
 * Everything the runtime service's Effect runtime builds. The service is migrating module by module
 * off Promise-based Nest classes: a module is listed here once its services are Layers.
 */
export const RuntimeLive = RuntimeDb.Live
