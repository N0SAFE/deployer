import { Context } from 'effect'

import type { DeploymentRepository } from '../repositories/deployment.repository'
import type { DeploymentServiceShape } from '../services/deployment.service'

/**
 * What the trigger sources and event-triggered deployments depend on, as Effect ports over
 * Promise-based Nest providers (registered in the deployment module with `useExisting`): the
 * repository that links a repository URL to a service, and the 2,500-line queue writer that has
 * not moved yet.
 */
export class TriggerServiceLinkPort extends Context.Service<
    TriggerServiceLinkPort,
    Pick<DeploymentRepository, 'findServiceBySourceUrl'>
>()('runtime/TriggerServiceLinkPort') {}
export class SystemDeploymentsPort extends Context.Service<
    SystemDeploymentsPort,
    Pick<DeploymentServiceShape, 'triggerDeploymentAsSystem'>
>()('runtime/SystemDeploymentsPort') {}
