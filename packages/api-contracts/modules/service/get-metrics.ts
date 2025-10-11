import { oc } from '@orpc/contract';
import { getServiceMetricsInput, getServiceMetricsOutput } from './schemas';
export const serviceGetMetricsContract = oc
    .route({
    method: 'GET',
    path: '/:id/metrics',
    summary: 'Get service metrics',
    description: 'Retrieve performance metrics for a specific service',
})
    .input(getServiceMetricsInput)
    .output(getServiceMetricsOutput);
