import { oc } from '@orpc/contract';
import { getServiceHealthInput, getServiceHealthOutput } from './schemas';
export const serviceGetHealthContract = oc
    .route({
    method: 'GET',
    path: '/:id/health',
    summary: 'Get service health status',
    description: 'Retrieve health check status and diagnostics for a specific service',
})
    .input(getServiceHealthInput)
    .output(getServiceHealthOutput);
