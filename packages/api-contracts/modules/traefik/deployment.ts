import { oc } from '@orpc/contract';
import { z } from 'zod';
import { 
  RegisterDeploymentSchema, 
  DeploymentRegistrationResponseSchema 
} from './schemas';

// Deployment registration contracts
export const traefikRegisterDeploymentContract = oc
  .route({
    method: 'POST',
    path: '/instances/:instanceId/deployments/register',
    summary: 'Register a deployment with Traefik',
  })
  .input(z.object({
    instanceId: z.string(),
  }).merge(RegisterDeploymentSchema))
  .output(DeploymentRegistrationResponseSchema);

export const traefikUnregisterDeploymentContract = oc
  .route({
    method: 'DELETE',
    path: '/deployments/:deploymentId',
    summary: 'Unregister a deployment from Traefik',
  })
  .input(z.object({
    deploymentId: z.string().min(1),
  }))
  .output(z.void());