import * as z from "zod/v4";
import { deploymentQueueJobSchema } from "@repo/contracts-entities";

export const deploymentBullEnqueueInputSchema = deploymentQueueJobSchema.extend({
    payload: deploymentQueueJobSchema.shape.payload.extend({
        deploymentId: z.uuid(),
        serviceId: z.uuid(),
        environment: z.enum(["production", "staging", "preview", "development"]),
    }),
});

export const deploymentBullEnqueueOutputSchema = z.object({
    bullJobId: z.string().min(1),
    bullQueueName: z.string().min(1),
    bullJobName: z.string().min(1),
});

export type DeploymentBullEnqueueInput = z.infer<typeof deploymentBullEnqueueInputSchema>;
export type DeploymentBullEnqueueOutput = z.infer<typeof deploymentBullEnqueueOutputSchema>;
