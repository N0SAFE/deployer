import { Logger } from '@nestjs/common';
import type { Job, Queue, JobOptions as BullJobOptions } from 'bull';
import type { ZodError } from 'zod/v4';
import {
  type JobContracts,
  type JobContract,
  type JobData,
  type JobResult,
  type JobEventOutput,
  type HasJobEvents,
  type JobName,
  type JobOptions,
  toBullJobOptions,
} from './job-contract.builder';
import type { BaseEventService } from '../events/base-event.service';
import type { EventContracts } from '../events/event-contract.builder';

/**
 * Emit function type for jobs with events
 */
export type JobEmitFn<TContract extends JobContract> = (output: JobEventOutput<TContract>) => void;

/**
 * Base handler params (without emit)
 */
interface BaseJobHandlerParams<TContract extends JobContract> {
  job: Job<JobData<TContract>>;
  data: JobData<TContract>;
  progress: (percent: number) => Promise<void>;
  log: (message: string) => void;
}

/**
 * Handler params with emit for contracts that have events
 */
interface JobHandlerParamsWithEmit<TContract extends JobContract> extends BaseJobHandlerParams<TContract> {
  emit: JobEmitFn<TContract>;
}

/**
 * Job handler function type
 * Includes emit function only when contract has events defined
 */
export type JobHandler<TContract extends JobContract> = 
  HasJobEvents<TContract> extends true
    ? (params: JobHandlerParamsWithEmit<TContract>) => Promise<JobResult<TContract>>
    : (params: BaseJobHandlerParams<TContract>) => Promise<JobResult<TContract>>;

/**
 * Job handlers map type
 */
export type JobHandlers<TContracts extends JobContracts> = {
  [K in keyof TContracts]: JobHandler<TContracts[K]>;
};

/**
 * Job add options (merges contract defaults with per-job overrides)
 */
export interface AddJobOptions extends Partial<JobOptions> {
  /** Override job ID */
  jobId?: string;
}

/**
 * Job add result
 */
export interface AddJobResult<TContract extends JobContract> {
  /** Bull job ID */
  jobId: string;
  /** Queue name */
  queueName: string;
  /** Job name */
  jobName: string;
  /** Job data */
  data: JobData<TContract>;
}

/**
 * Job completion result
 */
export interface JobCompletionResult<TContract extends JobContract> {
  /** Whether the job completed successfully */
  success: boolean;
  /** Job result if successful */
  result?: JobResult<TContract>;
  /** Error message if failed */
  error?: string;
  /** Job duration in milliseconds */
  duration: number;
}

/**
 * Validation error for job data
 */
export class JobValidationError extends Error {
  constructor(
    public readonly jobName: string,
    public readonly zodError: ZodError,
    message?: string,
  ) {
    super(message ?? `Job data validation failed for '${jobName}': ${zodError.message}`);
    this.name = 'JobValidationError';
  }
}

/**
 * Validation error for job result
 */
export class JobResultValidationError extends Error {
  constructor(
    public readonly jobName: string,
    public readonly zodError: ZodError,
    message?: string,
  ) {
    super(message ?? `Job result validation failed for '${jobName}': ${zodError.message}`);
    this.name = 'JobResultValidationError';
  }
}

/**
 * Base Processor Service
 * 
 * Abstract base class for type-safe Bull queue processors.
 * Provides type-safe job handling with automatic Zod validation.
 * Optionally integrates with BaseEventService for typed event emission.
 * 
 * @template TContracts - Map of job names to their contracts
 * @template TEventService - Optional event service type for job events
 * 
 * @example
 * ```typescript
 * // Define contracts with events
 * const deploymentContracts = {
 *   deploy: jobContractBuilder()
 *     .data(z.object({ deploymentId: z.string(), serviceId: z.string() }))
 *     .result(z.object({ success: z.boolean(), containerId: z.string().optional() }))
 *     .events()
 *       .output(z.object({ progress: z.number(), status: z.string() }))
 *       .strategy(ProcessingStrategy.PARALLEL)
 *       .build()
 *     .priority(JobPriority.HIGH)
 *     .build(),
 *   cleanup: jobContractBuilder()
 *     .data(z.object({ deploymentId: z.string() }))
 *     .result(z.object({ cleaned: z.boolean() }))
 *     .build(),
 * } satisfies JobContracts;
 * 
 * // Create processor service with event service
 * @Injectable()
 * @Processor('deployment')
 * class DeploymentProcessorService extends BaseProcessorService<typeof deploymentContracts> {
 *   constructor(
 *     @InjectQueue('deployment') queue: Queue,
 *     private readonly deploymentEvents: DeploymentEventService,
 *   ) {
 *     super('deployment', queue, deploymentContracts, deploymentEvents);
 *   }
 * 
 *   protected getHandlers(): JobHandlers<typeof deploymentContracts> {
 *     return {
 *       deploy: async ({ data, progress, log, emit }) => {
 *         log(`Deploying ${data.deploymentId}`);
 *         emit({ progress: 0, status: 'Starting deployment' });
 *         await progress(50);
 *         emit({ progress: 50, status: 'Building container' });
 *         return { success: true, containerId: 'container-123' };
 *       },
 *       cleanup: async ({ data, log }) => {
 *         log(`Cleaning up ${data.deploymentId}`);
 *         return { cleaned: true };
 *       },
 *     };
 *   }
 * }
 * ```
 */
export abstract class BaseProcessorService<
  TContracts extends JobContracts = JobContracts,
  TEventService extends BaseEventService | undefined = undefined,
> {
  protected readonly logger: Logger;
  private handlers?: JobHandlers<TContracts>;

  constructor(
    protected readonly queueName: string,
    protected readonly queue: Queue,
    protected readonly contracts: TContracts,
    protected readonly eventService?: TEventService,
  ) {
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * Override this method to provide job handlers
   * Called lazily on first job processing
   */
  protected abstract getHandlers(): JobHandlers<TContracts>;

  /**
   * Get handlers (lazy initialization)
   */
  private ensureHandlers(): JobHandlers<TContracts> {
    this.handlers ??= this.getHandlers();
    
    return this.handlers;
  }

  /**
   * Add a job to the queue with type-safe data
   * 
   * @param jobName - Name of the job (must match a contract key)
   * @param data - Job data (validated against contract schema)
   * @param options - Optional job options (merged with contract defaults)
   * @returns Promise resolving to job metadata
   */
  async addJob<K extends JobName<TContracts>>(
    jobName: K,
    data: JobData<TContracts[K]>,
    options?: AddJobOptions,
  ): Promise<AddJobResult<TContracts[K]>> {
    const contract = this.contracts[jobName];
    if (!contract) {
      throw new Error(`Contract not found for job: ${jobName}`);
    }

    // Validate job data
    const parseResult = contract.data.safeParse(data);
    if (!parseResult.success) {
      throw new JobValidationError(jobName, parseResult.error);
    }

    // Merge contract defaults with per-job options
    const mergedOptions = this.mergeJobOptions(contract.options, options);
    const bullOptions = toBullJobOptions(mergedOptions);

    // Add job to queue
    const job = await this.queue.add(jobName, parseResult.data, bullOptions as BullJobOptions);

    this.logger.log(`Added job '${jobName}' to queue '${this.queueName}' (id: ${String(job.id)})`);

    return {
      jobId: String(job.id),
      queueName: this.queueName,
      jobName: jobName,
      data: parseResult.data as JobData<TContracts[K]>,
    };
  }

  /**
   * Add multiple jobs to the queue (bulk operation)
   * 
   * @param jobs - Array of job name and data pairs
   * @returns Promise resolving to array of job results
   */
  async addBulk<K extends JobName<TContracts>>(
    jobs: {
      name: K;
      data: JobData<TContracts[K]>;
      options?: AddJobOptions;
    }[],
  ): Promise<AddJobResult<TContracts[K]>[]> {
    const results: AddJobResult<TContracts[K]>[] = [];

    // Validate all jobs first
    const validatedJobs = jobs.map(({ name, data, options }) => {
      const contract = this.contracts[name];
      if (!contract) {
        throw new Error(`Contract not found for job: ${name}`);
      }

      const parseResult = contract.data.safeParse(data);
      if (!parseResult.success) {
        throw new JobValidationError(name, parseResult.error);
      }

      const mergedOptions = this.mergeJobOptions(contract.options, options);
      const bullOptions = toBullJobOptions(mergedOptions);

      return {
        name: name,
        data: parseResult.data as JobData<TContracts[K]>,
        opts: bullOptions as BullJobOptions,
      };
    });

    // Add all jobs in bulk
    const addedJobs = await this.queue.addBulk(validatedJobs);

    for (let i = 0; i < addedJobs.length; i++) {
      const job = addedJobs[i];
      const originalJob = jobs[i];

      if (job) {
        const validatedJob = validatedJobs[i];
        if (validatedJob) {
          results.push({
            jobId: String(job.id),
            queueName: this.queueName,
            jobName: String(originalJob?.name),
            data: validatedJob.data,
          });
        }
      }
    }

    this.logger.log(`Added ${String(results.length)} jobs in bulk to queue '${this.queueName}'`);

    return results;
  }

  /**
   * Process a job - called by Bull @Process decorator
   * Validates input/output and delegates to the appropriate handler
   * 
   * @param job - Bull job instance
   * @returns Promise resolving to validated job result
   */
  async processJob<K extends JobName<TContracts>>(
    job: Job<JobData<TContracts[K]>>,
  ): Promise<JobResult<TContracts[K]>> {
    const jobName = job.name as K;
    const contract = this.contracts[jobName];
    const startTime = Date.now();

    if (!contract) {
      throw new Error(`Contract not found for job: ${jobName}`);
    }

    this.logger.log(`Processing job '${jobName}' (id: ${String(job.id)})`);

    // Validate input data
    const dataParseResult = contract.data.safeParse(job.data);
    if (!dataParseResult.success) {
      this.logger.error(`Job data validation failed for '${jobName}' (id: ${String(job.id)})`);
      throw new JobValidationError(jobName, dataParseResult.error);
    }

    const validatedData = dataParseResult.data as JobData<TContracts[K]>;

    // Get handler
    const handlers = this.ensureHandlers();
    const handler = handlers[jobName];

    // Create helper functions
    const progress = async (percent: number): Promise<void> => {
      await job.progress(percent);
      this.logger.debug(`Job '${jobName}' (id: ${String(job.id)}) progress: ${String(percent)}%`);
    };

    const log = (message: string): void => {
      this.logger.log(`[Job ${String(job.id)}] ${message}`);
    };

    // Create emit function if contract has events and event service is provided
    const emit = (output: JobEventOutput<TContracts[K]>): void => {
      if (contract.events && this.eventService) {
        // Validate output against event contract
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const validatedOutput = contract.events.output.parse(output);
        // Emit using the event service - use job name as event name
        // The event input is the job data
        this.eventService.emit(
          jobName as unknown as keyof EventContracts,
          validatedData as unknown as Parameters<typeof this.eventService.emit>[1],
          validatedOutput as unknown as Parameters<typeof this.eventService.emit>[2],
        );
        this.logger.debug(`Job '${jobName}' (id: ${String(job.id)}) emitted event`);
      } else if (contract.events && !this.eventService) {
        this.logger.warn(`Job '${jobName}' has events defined but no event service provided`);
      }
    };

    try {
      // Execute handler - build params with emit if contract has events
      const handlerParams: BaseJobHandlerParams<TContracts[K]> & { emit?: JobEmitFn<TContracts[K]> } = {
        job: job,
        data: validatedData,
        progress,
        log,
      };

      // Add emit function if contract has events
      if (contract.events) {
        handlerParams.emit = emit;
      }

      // Type assertion needed due to conditional handler type
      const result = await (handler as (params: BaseJobHandlerParams<TContracts[K]> & { emit?: JobEmitFn<TContracts[K]> }) => Promise<JobResult<TContracts[K]>>)(handlerParams);

      // Validate result
      const resultParseResult = contract.result.safeParse(result);
      if (!resultParseResult.success) {
        this.logger.error(`Job result validation failed for '${jobName}' (id: ${String(job.id)})`);
        throw new JobResultValidationError(jobName, resultParseResult.error);
      }

      const duration = Date.now() - startTime;
      this.logger.log(`Job '${jobName}' (id: ${String(job.id)}) completed in ${String(duration)}ms`);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return resultParseResult.data as JobResult<TContracts[K]>;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Job '${jobName}' (id: ${String(job.id)}) failed after ${String(duration)}ms: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  }> {
    const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
      this.queue.getPausedCount(),
    ]);

    return { waiting, active, completed, failed, delayed, paused };
  }

  /**
   * Get job by ID
   */
  async getJob<K extends JobName<TContracts>>(
    jobId: string,
  ): Promise<Job<JobData<TContracts[K]>> | null> {
    return this.queue.getJob(jobId) as Promise<Job<JobData<TContracts[K]>> | null>;
  }

  /**
   * Get job state by ID
   */
  async getJobState(jobId: string): Promise<string | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;
    return job.getState();
  }

  /**
   * Get failed jobs
   */
  async getFailedJobs(start = 0, end = 10): Promise<Job[]> {
    return this.queue.getFailed(start, end);
  }

  /**
   * Get completed jobs
   */
  async getCompletedJobs(start = 0, end = 10): Promise<Job[]> {
    return this.queue.getCompleted(start, end);
  }

  /**
   * Get active jobs
   */
  async getActiveJobs(start = 0, end = 10): Promise<Job[]> {
    return this.queue.getActive(start, end);
  }

  /**
   * Get waiting jobs
   */
  async getWaitingJobs(start = 0, end = 10): Promise<Job[]> {
    return this.queue.getWaiting(start, end);
  }

  /**
   * Get delayed jobs
   */
  async getDelayedJobs(start = 0, end = 10): Promise<Job[]> {
    return this.queue.getDelayed(start, end);
  }

  /**
   * Pause the queue
   */
  async pause(): Promise<void> {
    await this.queue.pause();
    this.logger.log(`Queue '${this.queueName}' paused`);
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    await this.queue.resume();
    this.logger.log(`Queue '${this.queueName}' resumed`);
  }

  /**
   * Clean old jobs from the queue
   */
  async clean(grace: number, status: 'completed' | 'wait' | 'active' | 'delayed' | 'failed' = 'completed'): Promise<void> {
    await this.queue.clean(grace, status);
    this.logger.log(`Cleaned ${status} jobs older than ${String(grace)}ms from queue '${this.queueName}'`);
  }

  /**
   * Empty the queue (remove all jobs)
   */
  async empty(): Promise<void> {
    await this.queue.empty();
    this.logger.log(`Emptied all jobs from queue '${this.queueName}'`);
  }

  /**
   * Get contract for a job type
   */
  getContract<K extends JobName<TContracts>>(jobName: K): TContracts[K] {
    const contract = this.contracts[jobName];
    if (!contract) {
      throw new Error(`Contract not found for job: ${jobName}`);
    }
    return contract;
  }

  /**
   * Get all registered job names
   */
  getJobNames(): JobName<TContracts>[] {
    return Object.keys(this.contracts) as JobName<TContracts>[];
  }

  /**
   * Validate job data without adding to queue
   */
  validateJobData<K extends JobName<TContracts>>(
    jobName: K,
    data: unknown,
  ): { valid: true; data: JobData<TContracts[K]> } | { valid: false; error: ZodError } {
    const contract = this.contracts[jobName];
    if (!contract) {
      throw new Error(`Contract not found for job: ${jobName}`);
    }

    const parseResult = contract.data.safeParse(data);
    if (parseResult.success) {
      return { valid: true, data: parseResult.data as JobData<TContracts[K]> };
    }
    return { valid: false, error: parseResult.error };
  }

  /**
   * Merge contract default options with per-job options
   */
  private mergeJobOptions(
    contractOptions?: JobOptions,
    jobOptions?: AddJobOptions,
  ): JobOptions {
    if (!contractOptions && !jobOptions) return {};

    return {
      ...contractOptions,
      ...jobOptions,
      retry: jobOptions?.retry ?? contractOptions?.retry,
    };
  }
}
