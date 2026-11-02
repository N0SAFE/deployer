import { Context } from 'effect'

import type { DeploymentTriggerRegistryService } from './deployment-trigger-registry.service'
import type { DeploymentService } from '../services/deployment.service'

/**
 * What event-triggered deployments depend on, as Effect ports over Promise-based Nest providers
 * (registered in the deployment module with `useExisting`). The registry and the trigger sources
 * are plugins with their own lifecycle logging, so they stay Nest providers; the deployment service
 * is the 2,500-line queue writer that has not moved yet.
 */
export class TriggerRegistryPort extends Context.Service<
    TriggerRegistryPort,
    DeploymentTriggerRegistryService
>()('runtime/TriggerRegistryPort') {}
export class SystemDeploymentsPort extends Context.Service<
    SystemDeploymentsPort,
    DeploymentService
>()('runtime/SystemDeploymentsPort') {}
