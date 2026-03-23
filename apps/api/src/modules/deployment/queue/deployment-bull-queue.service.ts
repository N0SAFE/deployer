import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import type { Job, JobOptions, Queue } from "bull";
import type { DeploymentQueueJob } from "@repo/api-contracts/common/deployment";
import {
    deploymentBullEnqueueInputSchema,
    deploymentBullEnqueueOutputSchema,
    type DeploymentBullEnqueueOutput,
} from "./deployment-bull-queue.contracts";

type DeploymentBullJobName = "deploy" | "rollback" | "retry";

interface DeploymentBullJobData {
    deploymentId: string;
    serviceId: string;
    environment: string;
    payload: DeploymentQueueJob["payload"];
    idempotencyKey: string;
}

@Injectable()
export class DeploymentBullQueueService {
    private readonly logger = new Logger(DeploymentBullQueueService.name);

    constructor(
        @InjectQueue("deployment")
        private readonly deploymentQueue: Queue,
    ) {}

    async enqueueFromQueueJob(job: DeploymentQueueJob): Promise<DeploymentBullEnqueueOutput> {
        const parsedInput = deploymentBullEnqueueInputSchema.parse(job);

        const jobName = this.toBullJobName(parsedInput.type);
        const data: DeploymentBullJobData = {
            deploymentId: parsedInput.payload.deploymentId,
            serviceId: parsedInput.payload.serviceId,
            environment: parsedInput.payload.environment,
            payload: parsedInput.payload,
            idempotencyKey: parsedInput.idempotencyKey,
        };

        const options: JobOptions = {
            jobId: parsedInput.idempotencyKey,
            attempts: parsedInput.maxAttempts,
            removeOnComplete: 20,
            removeOnFail: 50,
            backoff: {
                type: "exponential",
                delay: 5000,
            },
        };

        const bullJob: Job = await this.deploymentQueue.add(jobName, data, options);
        const output = {
            bullJobId: String(bullJob.id),
            bullQueueName: this.deploymentQueue.name,
            bullJobName: jobName,
        } satisfies DeploymentBullEnqueueOutput;

        return deploymentBullEnqueueOutputSchema.parse(output);
    }

    private toBullJobName(type: DeploymentQueueJob["type"]): DeploymentBullJobName {
        if (type === "rollback") {
            return "rollback";
        }
        if (type === "retry") {
            return "retry";
        }
        return "deploy";
    }
}
