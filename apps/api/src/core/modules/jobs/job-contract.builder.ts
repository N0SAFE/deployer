import type { z } from 'zod/v4';
import {
  type EventContract,
  type EventContractOptions,
  type AbortContext,
  ProcessingStrategy,
} from '../events/event-contract.builder';

// Re-export event types for convenience
export { ProcessingStrategy, type EventContractOptions, type AbortContext };

/**
 * Job priority levels
 * Higher numbers = higher priority (processed first)
 */
export enum JobPriority {
  /** Lowest priority - processed when queue is idle */
  LOW = 1,
  /** Normal priority - standard processing order */
  NORMAL = 5,
  /** High priority - processed before normal jobs */
  HIGH = 10,
  /** Critical priority - processed immediately */
  CRITICAL = 20,
}

/**
 * Backoff strategy for retrying failed jobs
 */
export enum BackoffStrategy {
  /** Fixed delay between retries */
  FIXED = 'fixed',
  /** Exponentially increasing delay between retries */
  EXPONENTIAL = 'exponential',
}

/**
 * Job retry configuration
 */
export interface JobRetryConfig {
  /** Number of retry attempts (default: 3) */
  attempts?: number;
  /** Backoff strategy (default: EXPONENTIAL) */
  backoff?: BackoffStrategy;
  /** Delay in milliseconds (default: 2000) */
  delay?: number;
}

/**
 * Job options for Bull queue
 */
export interface JobOptions {
  /** Job priority (default: NORMAL) */
  priority?: JobPriority;
  /** Delay in milliseconds before job starts */
  delay?: number;
  /** Retry configuration */
  retry?: JobRetryConfig;
  /** Number of completed jobs to keep (default: 10) */
  removeOnComplete?: number | boolean;
  /** Number of failed jobs to keep (default: 25) */
  removeOnFail?: number | boolean;
  /** Job timeout in milliseconds */
  timeout?: number;
  /** Job ID (for deduplication) */
  jobId?: string;
  /** LIFO mode - last in first out */
  lifo?: boolean;
}

/**
 * Job contract definition
 * Each job has a data schema (input), result schema (output), and optional events
 */
export interface JobContract<TData = unknown, TResult = unknown, TEventOutput = unknown> {
  /** Zod schema for job data (input) */
  data: z.ZodType<TData>;
  /** Zod schema for job result (output) */
  result: z.ZodType<TResult>;
  /** Default job options */
  options?: JobOptions;
  /** Human-readable job description */
  description?: string;
  /** Event contract for job progress events (optional) */
  events?: EventContract<TData, TEventOutput>;
}

/**
 * Job contracts definition map
 * Maps job names to their contracts
 * Uses a more flexible type to allow specific data/result/event types
 */
 
export type JobContracts = Record<string, JobContract<any, any, any>>;

/**
 * Extract data type from job contract (input)
 */
export type JobData<T extends JobContract> = z.infer<T['data']>;

/**
 * Extract result type from job contract (output)
 */
export type JobResult<T extends JobContract> = z.infer<T['result']>;

/**
 * Extract event output type from job contract
 */
export type JobEventOutput<T extends JobContract> = T['events'] extends EventContract<unknown, infer TOutput>
  ? TOutput
  : never;

/**
 * Check if job contract has events
 */
export type HasJobEvents<T extends JobContract> = T['events'] extends EventContract ? true : false;

/**
 * Job names from contracts
 */
export type JobName<T extends JobContracts> = Extract<keyof T, string>;

/**
 * Job event contract builder
 * Nested builder for defining events within a job contract
 * Returns back to the parent JobContractBuilder after build()
 */
class JobEventContractBuilder<TData, TResult, TEventOutput = never, TParent extends JobContractBuilderWithEvents<TData, TResult, unknown> = JobContractBuilderWithEvents<TData, TResult, unknown>> {
  private _output?: z.ZodType<TEventOutput>;
  private _options?: EventContractOptions<TData>;

  constructor(private readonly _parent: TParent, private readonly _inputSchema: z.ZodType<TData>) {}

  /**
   * Set event output schema (what will be emitted)
   */
  output<T>(schema: z.ZodType<T>): JobEventContractBuilder<TData, TResult, T, TParent> {
    const builder = this as unknown as JobEventContractBuilder<TData, TResult, T, TParent>;
    builder._output = schema;
    return builder;
  }

  /**
   * Set processing strategy
   */
  strategy(strategyType: ProcessingStrategy): this {
    this._options = { ...this._options, strategy: strategyType };
    return this;
  }

  /**
   * Build the event contract and return to parent job builder
   */
  build(): JobContractBuilderWithEvents<TData, TResult, TEventOutput> {
    if (!this._output) {
      throw new Error('Event output schema is required. Call .output() before .build()');
    }

    const eventContract: EventContract<TData, TEventOutput> = {
      input: this._inputSchema,
      output: this._output,
      options: this._options,
    };

    // Return parent builder with event contract set
    return this._parent._setEvents(eventContract) as unknown as JobContractBuilderWithEvents<TData, TResult, TEventOutput>;
  }
}

/**
 * Job contract builder with events support
 * Extended builder that has events configured
 */
class JobContractBuilderWithEvents<TData = never, TResult = never, TEventOutput = never> {
  protected _data?: z.ZodType<TData>;
  protected _result?: z.ZodType<TResult>;
  protected _options?: JobOptions;
  protected _description?: string;
  protected _events?: EventContract<TData, TEventOutput>;

  /**
   * Set job data schema (input)
   */
  data<T>(schema: z.ZodType<T>): JobContractBuilderWithEvents<T, TResult, TEventOutput> {
    const builder = this as unknown as JobContractBuilderWithEvents<T, TResult, TEventOutput>;
    builder._data = schema;
    return builder;
  }

  /**
   * Set job result schema (output)
   */
  result<T>(schema: z.ZodType<T>): JobContractBuilderWithEvents<TData, T, TEventOutput> {
    const builder = this as unknown as JobContractBuilderWithEvents<TData, T, TEventOutput>;
    builder._result = schema;
    return builder;
  }

  /**
   * Add events to this job contract
   * Returns a nested event contract builder
   * The event input is automatically the job data
   */
  events(): JobEventContractBuilder<TData, TResult, never, this> {
    if (!this._data) {
      throw new Error('Data schema is required before adding events. Call .data() first');
    }
    return new JobEventContractBuilder<TData, TResult, never, this>(this, this._data);
  }

  /**
   * Internal: Set events from nested builder
   */
  _setEvents<TNewEventOutput>(eventContract: EventContract<TData, TNewEventOutput>): JobContractBuilderWithEvents<TData, TResult, TNewEventOutput> {
    const builder = this as unknown as JobContractBuilderWithEvents<TData, TResult, TNewEventOutput>;
    builder._events = eventContract;
    return builder;
  }

  /**
   * Set job priority
   */
  priority(level: JobPriority): this {
    this._options = { ...this._options, priority: level };
    return this;
  }

  /**
   * Set job delay in milliseconds
   */
  delay(ms: number): this {
    this._options = { ...this._options, delay: ms };
    return this;
  }

  /**
   * Set retry configuration
   */
  retry(config: JobRetryConfig): this {
    this._options = { ...this._options, retry: config };
    return this;
  }

  /**
   * Set job timeout in milliseconds
   */
  timeout(ms: number): this {
    this._options = { ...this._options, timeout: ms };
    return this;
  }

  /**
   * Set remove on complete behavior
   */
  removeOnComplete(value: number | boolean): this {
    this._options = { ...this._options, removeOnComplete: value };
    return this;
  }

  /**
   * Set remove on fail behavior
   */
  removeOnFail(value: number | boolean): this {
    this._options = { ...this._options, removeOnFail: value };
    return this;
  }

  /**
   * Set full job options
   */
  options(opts: JobOptions): this {
    this._options = { ...this._options, ...opts };
    return this;
  }

  /**
   * Set job description
   */
  description(desc: string): this {
    this._description = desc;
    return this;
  }

  /**
   * Build the final contract
   */
  build(): JobContract<TData, TResult, TEventOutput> {
    if (!this._data) {
      throw new Error('Data schema is required. Call .data() before .build()');
    }
    if (!this._result) {
      throw new Error('Result schema is required. Call .result() before .build()');
    }

    return {
      data: this._data,
      result: this._result,
      options: this._options,
      description: this._description,
      events: this._events,
    };
  }
}

/**
 * Job contract builder
 * Provides fluent API for building type-safe job contracts
 */
class JobContractBuilder<TData = never, TResult = never> extends JobContractBuilderWithEvents<TData, TResult> {}

/**
 * Create a new job contract builder
 * 
 * @example
 * ```typescript
 * // Basic job without events
 * const cleanupContract = jobContractBuilder()
 *   .data(z.object({ deploymentId: z.string() }))
 *   .result(z.object({ cleaned: z.boolean() }))
 *   .build();
 * 
 * // Job with events for progress tracking
 * const deployContract = jobContractBuilder()
 *   .data(z.object({ 
 *     deploymentId: z.string(),
 *     serviceId: z.string(),
 *   }))
 *   .result(z.object({ 
 *     success: z.boolean(),
 *     containerId: z.string().optional(),
 *   }))
 *   // Add events for real-time progress updates
 *   .events()
 *     .output(z.object({
 *       progress: z.number(),
 *       status: z.string(),
 *     }))
 *     .strategy(ProcessingStrategy.PARALLEL)
 *     .build()
 *   .priority(JobPriority.HIGH)
 *   .retry({ attempts: 3, backoff: BackoffStrategy.EXPONENTIAL, delay: 2000 })
 *   .timeout(300000) // 5 minutes
 *   .description('Deploy a service to Docker Swarm')
 *   .build();
 * 
 * const contracts = {
 *   deploy: deployContract,
 *   cleanup: cleanupContract,
 * } satisfies JobContracts;
 * ```
 */
export function jobContractBuilder(): JobContractBuilder {
  return new JobContractBuilder();
}

/**
 * Convert job options to Bull job options
 */
export function toBullJobOptions(options?: JobOptions): Record<string, unknown> {
  if (!options) return {};

  const bullOptions: Record<string, unknown> = {};

  if (options.priority !== undefined) {
    bullOptions.priority = options.priority;
  }

  if (options.delay !== undefined) {
    bullOptions.delay = options.delay;
  }

  if (options.retry) {
    bullOptions.attempts = options.retry.attempts ?? 3;
    bullOptions.backoff = {
      type: options.retry.backoff === BackoffStrategy.FIXED ? 'fixed' : 'exponential',
      delay: options.retry.delay ?? 2000,
    };
  }

  if (options.timeout !== undefined) {
    bullOptions.timeout = options.timeout;
  }

  if (options.removeOnComplete !== undefined) {
    bullOptions.removeOnComplete = options.removeOnComplete;
  }

  if (options.removeOnFail !== undefined) {
    bullOptions.removeOnFail = options.removeOnFail;
  }

  if (options.jobId !== undefined) {
    bullOptions.jobId = options.jobId;
  }

  if (options.lifo !== undefined) {
    bullOptions.lifo = options.lifo;
  }

  return bullOptions;
}
