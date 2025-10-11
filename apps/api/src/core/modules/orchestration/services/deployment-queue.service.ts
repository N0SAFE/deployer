import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import type { Queue } from "bull";
import type {
  DeploymentJobData,
  RollbackJobData,
  HealthCheckJobData,
  CleanupJobData,
} from "@/core/modules/orchestration/types/deployment-job.types";
@Injectable()
export class DeploymentQueueService {
  private readonly logger = new Logger(DeploymentQueueService.name);
  constructor(
    @InjectQueue("deployment")
    private deploymentQueue: Queue
  ) {}
  async addDeploymentJob(
    jobData: DeploymentJobData,
    priority: number = 0
  ): Promise<string> {
    this.logger.log(
      `Adding deployment job for deployment ${jobData.deploymentId}`
    );

    try {
      // Verify job data is serializable before adding to queue
      JSON.stringify(jobData);

      const job = await this.deploymentQueue.add("deploy", jobData, {
        priority,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000, // 5 seconds
        },
        removeOnComplete: 10, // Keep last 10 completed jobs
        removeOnFail: 25, // Keep last 25 failed jobs
      });

      this.logger.log(`Deployment job ${job.id} added to queue`);
      return job.id.toString();
    } catch (error) {
      this.logger.error(
        `Failed to add deployment job for deployment ${jobData.deploymentId}:`,
        error
      );

      // Create a serializable error
      const serializableError = new Error(
        error instanceof Error
          ? `Job queue error: ${error.message}`
          : "Failed to add job to queue"
      );
      throw serializableError;
    }
  }
  test() {
    this.deploymentQueue.add("test", { foo: "bar" });
  }

  async addRollbackJob(
    jobData: RollbackJobData,
    priority: number = 10
  ): Promise<string> {
    this.logger.log(
      `Adding rollback job from ${jobData.deploymentId} to ${jobData.targetDeploymentId}`
    );
    const job = await this.deploymentQueue.add("rollback", jobData, {
      priority, // Higher priority for rollbacks
      attempts: 2,
      backoff: {
        type: "fixed",
        delay: 3000, // 3 seconds
      },
      removeOnComplete: 5,
      removeOnFail: 10,
    });
    this.logger.log(`Rollback job ${job.id} added to queue`);
    return job.id.toString();
  }
  async addHealthCheckJob(jobData: HealthCheckJobData): Promise<string> {
    this.logger.log(
      `Adding health check job for deployment ${jobData.deploymentId}`
    );
    const job = await this.deploymentQueue.add("health-check", jobData, {
      delay: 30000, // Wait 30 seconds before first health check
      attempts: 5,
      backoff: {
        type: "fixed",
        delay: 10000, // 10 seconds between retries
      },
      removeOnComplete: 5,
      removeOnFail: 5,
    });
    return job.id.toString();
  }
  async addCleanupJob(
    jobData: CleanupJobData,
    delay: number = 0
  ): Promise<string> {
    this.logger.log(
      `Adding cleanup job for deployment ${jobData.deploymentId}`
    );
    const job = await this.deploymentQueue.add("cleanup", jobData, {
      delay,
      attempts: 2,
      backoff: {
        type: "fixed",
        delay: 5000,
      },
      removeOnComplete: 3,
      removeOnFail: 5,
    });
    return job.id.toString();
  }
  async getJobStatus(jobId: string): Promise<{
    id: string;
    status: string;
    progress: number;
    data: any;
    result?: any;
    error?: any;
  }> {
    const job = await this.deploymentQueue.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    const state = await job.getState();
    return {
      id: job.id.toString(),
      status: state,
      progress: job.progress(),
      data: job.data,
      result: job.returnvalue,
      error: job.failedReason,
    };
  }
  async cancelJob(jobId: string): Promise<void> {
    this.logger.log(`Cancelling job ${jobId}`);
    const job = await this.deploymentQueue.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    await job.remove();
    this.logger.log(`Job ${jobId} cancelled`);
  }
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.deploymentQueue.getWaiting(),
      this.deploymentQueue.getActive(),
      this.deploymentQueue.getCompleted(),
      this.deploymentQueue.getFailed(),
      this.deploymentQueue.getDelayed(),
    ]);
    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }
  async pauseQueue(): Promise<void> {
    await this.deploymentQueue.pause();
    this.logger.log("Deployment queue paused");
  }
  async resumeQueue(): Promise<void> {
    await this.deploymentQueue.resume();
    this.logger.log("Deployment queue resumed");
  }
  async cleanOldJobs(): Promise<void> {
    this.logger.log("Cleaning old jobs from deployment queue");
    await this.deploymentQueue.clean(24 * 60 * 60 * 1000, "completed"); // 24 hours
    await this.deploymentQueue.clean(7 * 24 * 60 * 60 * 1000, "failed"); // 7 days
    this.logger.log("Old jobs cleaned from deployment queue");
  }
  async retryFailedJobs(): Promise<number> {
    this.logger.log("Retrying all failed jobs");
    const failedJobs = await this.deploymentQueue.getFailed();
    for (const job of failedJobs) {
      await job.retry();
    }
    this.logger.log(`Retried ${failedJobs.length} failed jobs`);
    return failedJobs.length;
  }
  // Get deployment jobs by deployment ID
  async getDeploymentJobs(deploymentId: string): Promise<any[]> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.deploymentQueue.getWaiting(),
      this.deploymentQueue.getActive(),
      this.deploymentQueue.getCompleted(),
      this.deploymentQueue.getFailed(),
    ]);
    const allJobs = [...waiting, ...active, ...completed, ...failed];
    return allJobs.filter(
      (job) => job.data && job.data.deploymentId === deploymentId
    );
  }
}
