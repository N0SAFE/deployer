import { Layer } from 'effect'

import { ProjectDb } from '@project/core/database/project-db'
import { ApiKeyStore } from './repositories/api-key.repository'
import { ProjectStore } from './repositories/project.repository'
import { WebhookStore } from './repositories/webhook.repository'
import { ApiKeyService } from './services/api-key.service'
import { ProjectEventServiceLayer } from './services/project-event.service'
import { ProjectNetworkService } from './services/project-network.service'
import { ProjectService } from './services/project.service'
import { WebhookService } from './services/webhook.service'

/**
 * The data access of the project module, built over `DatabasePort`. `ProjectDb` (transactions with
 * cancellation) stays visible, so the service module's store can use it too.
 */
const StoresLive = Layer.mergeAll(
    ProjectStore.Live,
    ApiKeyStore.Live,
    WebhookStore.Live
).pipe(Layer.provideMerge(ProjectDb.Live))

/** The use cases, built over the stores and the project event bus. */
const ServicesLive = Layer.mergeAll(
    ProjectService.Live,
    ProjectNetworkService.Live,
    WebhookService.Live,
    ApiKeyService.Live
)

/**
 * The project module, assembled: stores and the event bus first, the services over them, everything
 * visible to the runtime (other modules reach `ProjectStore` and the event bus through it).
 */
export const ProjectLive = ServicesLive.pipe(
    Layer.provideMerge(Layer.mergeAll(StoresLive, ProjectEventServiceLayer))
)
