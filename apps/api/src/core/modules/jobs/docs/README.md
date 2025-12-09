# Jobs Module

> **Type**: Core Infrastructure Module  
> **Last Updated**: 2025-01-20

## Overview

The Jobs module provides a **contract-based job system** for type-safe Bull queue processing. It uses Zod schemas for input/output validation and provides a structured approach to defining and handling background jobs.

**Key Features:**
- 🔒 **Type-safe**: Full TypeScript inference from Zod schemas
- ✅ **Validation**: Automatic input/output validation via Zod
- 🔄 **Retry support**: Built-in retry with exponential/fixed backoff
- ⏱️ **Job options**: Priority, delay, timeout, and more
- 📊 **Queue management**: Statistics, pause/resume, clean operations
- 🎯 **Bulk operations**: Add multiple jobs efficiently

## Architecture

```
jobs/
├── jobs.module.ts             # NestJS module definition
├── base-processor.service.ts  # Abstract base class for processors
├── job-contract.builder.ts    # Contract builder and types
├── index.ts                   # Re-exports
└── docs/
    └── README.md              # This documentation
```

## Quick Start

### Step 1: Define Job Contracts

Contracts define the shape of your jobs using Zod schemas. Each contract has:
- **data**: The job input (payload to process)
- **result**: The job output (what the handler returns)
- **options**: Default job options (priority, retry, timeout, etc.)

```typescript
import { jobContractBuilder, JobContracts, JobPriority, BackoffStrategy } from "@/core/modules/jobs";
import { z } from "zod";

// Define your job contracts
const deployContract = jobContractBuilder()
  .data(z.object({
    deploymentId: z.string().describe("Deployment ID"),
    serviceId: z.string().describe("Service ID"),
    projectId: z.string().describe("Project ID"),
    sourceConfig: z.object({
      type: z.enum(["github", "gitlab", "git", "upload"]),
      repositoryUrl: z.string().optional(),
      branch: z.string().optional(),
    }),
  }))
  .result(z.object({
    success: z.boolean(),
    containerId: z.string().optional(),
    error: z.string().optional(),
    message: z.string(),
  }))
  .priority(JobPriority.HIGH)
  .retry({ attempts: 3, backoff: BackoffStrategy.EXPONENTIAL, delay: 2000 })
  .timeout(300000) // 5 minutes
  .description("Deploy a service to Docker Swarm")
  .build();

// Group related contracts
export const deploymentContracts = {
  deploy: deployContract,
  cleanup: jobContractBuilder()
    .data(z.object({ deploymentId: z.string() }))
    .result(z.object({ cleaned: z.boolean() }))
    .build(),
  rollback: jobContractBuilder()
    .data(z.object({ 
      deploymentId: z.string(),
      targetDeploymentId: z.string(),
    }))
    .result(z.object({ 
      success: z.boolean(),
      error: z.string().optional(),
    }))
    .priority(JobPriority.CRITICAL)
    .build(),
} satisfies JobContracts;
```

### Step 2: Create Processor Service

Extend `BaseProcessorService` with your contracts:

```typescript
import { Injectable } from "@nestjs/common";
import { Processor, Process, InjectQueue } from "@nestjs/bull";
import type { Queue, Job } from "bull";
import { BaseProcessorService, JobHandlers } from "@/core/modules/jobs";
import { deploymentContracts } from "./deployment.contracts";

@Injectable()
@Processor("deployment")
export class DeploymentProcessorService extends BaseProcessorService<typeof deploymentContracts> {
  constructor(
    @InjectQueue("deployment") queue: Queue,
    private readonly orchestrator: DeploymentOrchestrator,
  ) {
    super("deployment", queue, deploymentContracts);
  }

  // Required: Provide handlers for each job type
  protected getHandlers(): JobHandlers<typeof deploymentContracts> {
    return {
      deploy: this.handleDeploy.bind(this),
      cleanup: this.handleCleanup.bind(this),
      rollback: this.handleRollback.bind(this),
    };
  }

  // Handler implementation with full type safety
  private async handleDeploy({ data, progress, log }) {
    log(`Starting deployment ${data.deploymentId}`);
    
    await progress(10);
    
    // Your deployment logic here
    const result = await this.orchestrator.deploy(data.serviceId, data.sourceConfig);
    
    await progress(100);
    
    return {
      success: result.status === "success",
      containerId: result.containerId,
      message: "Deployment completed",
    };
  }

  private async handleCleanup({ data, log }) {
    log(`Cleaning up deployment ${data.deploymentId}`);
    // Cleanup logic
    return { cleaned: true };
  }

  private async handleRollback({ data, log }) {
    log(`Rolling back ${data.deploymentId} to ${data.targetDeploymentId}`);
    // Rollback logic
    return { success: true };
  }

  // Bull @Process decorators for each job type
  @Process("deploy")
  async processDeploy(job: Job) {
    return this.processJob(job);
  }

  @Process("cleanup")
  async processCleanup(job: Job) {
    return this.processJob(job);
  }

  @Process("rollback")
  async processRollback(job: Job) {
    return this.processJob(job);
  }
}
```

### Step 3: Register in Module

```typescript
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";
import { DeploymentProcessorService } from "./deployment-processor.service";

@Module({
  imports: [
    BullModule.registerQueue({
      name: "deployment",
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 25,
      },
    }),
  ],
  providers: [DeploymentProcessorService],
  exports: [DeploymentProcessorService],
})
export class DeploymentModule {}
```

### Step 4: Add Jobs to Queue

```typescript
import { Injectable } from "@nestjs/common";
import { DeploymentProcessorService } from "./deployment-processor.service";

@Injectable()
export class DeploymentService {
  constructor(private readonly processor: DeploymentProcessorService) {}

  async triggerDeployment(deploymentId: string, serviceId: string, projectId: string) {
    // Type-safe job data
    const result = await this.processor.addJob("deploy", {
      deploymentId,
      serviceId,
      projectId,
      sourceConfig: {
        type: "github",
        repositoryUrl: "https://github.com/user/repo",
        branch: "main",
      },
    });

    console.log(`Job added with ID: ${result.jobId}`);
    return result;
  }

  async triggerBulkDeployments(deployments: Array<{ deploymentId: string; serviceId: string; projectId: string }>) {
    // Add multiple jobs at once
    const results = await this.processor.addBulk(
      deployments.map((d) => ({
        name: "deploy" as const,
        data: {
          ...d,
          sourceConfig: { type: "github" as const },
        },
      })),
    );

    return results;
  }
}
```

---

## Job Priority Levels

```typescript
import { JobPriority } from "@/core/modules/jobs";

// Available priority levels (higher = processed first)
JobPriority.LOW       // 1 - Background tasks
JobPriority.NORMAL    // 5 - Standard jobs (default)
JobPriority.HIGH      // 10 - Important jobs
JobPriority.CRITICAL  // 20 - Urgent jobs (processed immediately)
```

**Usage:**
```typescript
const contract = jobContractBuilder()
  .data(z.object({ id: z.string() }))
  .result(z.object({ done: z.boolean() }))
  .priority(JobPriority.HIGH)
  .build();
```

---

## Retry Configuration

```typescript
import { BackoffStrategy } from "@/core/modules/jobs";

// Available backoff strategies
BackoffStrategy.FIXED        // Same delay between retries
BackoffStrategy.EXPONENTIAL  // Increasing delay (2s, 4s, 8s, ...)

// In contract definition
const contract = jobContractBuilder()
  .data(z.object({ id: z.string() }))
  .result(z.object({ done: z.boolean() }))
  .retry({
    attempts: 5,                            // Number of retries
    backoff: BackoffStrategy.EXPONENTIAL,   // Strategy
    delay: 3000,                            // Initial delay in ms
  })
  .build();
```

---

## Job Options

All available job options:

```typescript
interface JobOptions {
  priority?: JobPriority;       // Job priority level
  delay?: number;               // Delay before processing (ms)
  timeout?: number;             // Job timeout (ms)
  removeOnComplete?: number | boolean;  // Keep N completed jobs
  removeOnFail?: number | boolean;      // Keep N failed jobs
  jobId?: string;               // Custom job ID (for deduplication)
  lifo?: boolean;               // Last In First Out
  retry?: {
    attempts?: number;          // Retry attempts
    backoff?: BackoffStrategy;  // Backoff strategy
    delay?: number;             // Backoff delay (ms)
  };
}
```

**Full example:**
```typescript
const contract = jobContractBuilder()
  .data(z.object({ videoId: z.string() }))
  .result(z.object({ url: z.string() }))
  .priority(JobPriority.NORMAL)
  .delay(5000)                    // Wait 5s before starting
  .timeout(600000)                // 10 minute timeout
  .removeOnComplete(50)           // Keep 50 completed jobs
  .removeOnFail(100)              // Keep 100 failed jobs
  .retry({
    attempts: 3,
    backoff: BackoffStrategy.EXPONENTIAL,
    delay: 2000,
  })
  .description("Transcode uploaded video")
  .build();
```

---

## API Reference

### BaseProcessorService Methods

#### `addJob<K>(jobName, data, options?): Promise<AddJobResult>`

Add a single job to the queue with type-safe data.

```typescript
const result = await processor.addJob("deploy", {
  deploymentId: "dep-123",
  serviceId: "svc-456",
  projectId: "proj-789",
  sourceConfig: { type: "github" },
});

console.log(result.jobId);      // "1"
console.log(result.queueName);  // "deployment"
console.log(result.jobName);    // "deploy"
```

#### `addBulk(jobs): Promise<AddJobResult[]>`

Add multiple jobs efficiently.

```typescript
const results = await processor.addBulk([
  { name: "deploy", data: { /* ... */ } },
  { name: "cleanup", data: { deploymentId: "dep-123" } },
]);
```

#### `processJob(job): Promise<JobResult>`

Process a Bull job (called internally by @Process decorators).

```typescript
@Process("deploy")
async processDeploy(job: Job) {
  return this.processJob(job);  // Validates input/output automatically
}
```

#### `getQueueStats(): Promise<QueueStats>`

Get queue statistics.

```typescript
const stats = await processor.getQueueStats();
// { waiting: 5, active: 2, completed: 100, failed: 3, delayed: 0, paused: 0 }
```

#### `getJob(jobId): Promise<Job | null>`

Get a job by ID.

```typescript
const job = await processor.getJob("123");
if (job) {
  console.log(job.data);
  console.log(await job.getState());  // "completed", "failed", etc.
}
```

#### `getJobState(jobId): Promise<string | null>`

Get job state by ID.

```typescript
const state = await processor.getJobState("123");
// "waiting", "active", "completed", "failed", "delayed"
```

#### Queue Management

```typescript
// Pause/Resume
await processor.pause();
await processor.resume();

// Get jobs by status
const failed = await processor.getFailedJobs(0, 10);
const completed = await processor.getCompletedJobs(0, 10);
const active = await processor.getActiveJobs(0, 10);
const waiting = await processor.getWaitingJobs(0, 10);
const delayed = await processor.getDelayedJobs(0, 10);

// Clean old jobs (grace period in ms)
await processor.clean(3600000, "completed");  // Clean completed jobs older than 1 hour
await processor.clean(86400000, "failed");    // Clean failed jobs older than 1 day

// Drain all jobs
await processor.drain();
```

#### Utility Methods

```typescript
// Get contract for a job type
const contract = processor.getContract("deploy");

// Get all registered job names
const names = processor.getJobNames();  // ["deploy", "cleanup", "rollback"]

// Validate job data without adding to queue
const validation = processor.validateJobData("deploy", someData);
if (validation.valid) {
  console.log(validation.data);  // Validated and typed data
} else {
  console.error(validation.error);  // ZodError
}
```

---

## Complete Example: Video Processing Queue

### 1. Contracts Definition

```typescript
// video-job.contracts.ts
import { jobContractBuilder, JobContracts, JobPriority, BackoffStrategy } from "@/core/modules/jobs";
import { z } from "zod";

export const transcodeContract = jobContractBuilder()
  .data(z.object({
    videoId: z.string(),
    inputPath: z.string(),
    outputFormat: z.enum(["mp4", "webm", "hls"]),
    quality: z.enum(["low", "medium", "high", "ultra"]).default("high"),
  }))
  .result(z.object({
    outputPath: z.string(),
    duration: z.number(),
    size: z.number(),
    format: z.string(),
  }))
  .priority(JobPriority.NORMAL)
  .timeout(1800000)  // 30 minutes
  .retry({ attempts: 2, backoff: BackoffStrategy.FIXED, delay: 5000 })
  .description("Transcode video to target format")
  .build();

export const thumbnailContract = jobContractBuilder()
  .data(z.object({
    videoId: z.string(),
    videoPath: z.string(),
    timestamps: z.array(z.number()).default([0, 10, 30]),
  }))
  .result(z.object({
    thumbnails: z.array(z.object({
      timestamp: z.number(),
      path: z.string(),
    })),
  }))
  .priority(JobPriority.LOW)
  .timeout(60000)  // 1 minute
  .description("Generate video thumbnails")
  .build();

export const videoJobContracts = {
  transcode: transcodeContract,
  thumbnail: thumbnailContract,
} satisfies JobContracts;
```

### 2. Processor Service

```typescript
// video-processor.service.ts
import { Injectable } from "@nestjs/common";
import { Processor, Process, InjectQueue, OnQueueCompleted, OnQueueFailed } from "@nestjs/bull";
import type { Queue, Job } from "bull";
import { BaseProcessorService, JobHandlers } from "@/core/modules/jobs";
import { videoJobContracts } from "./video-job.contracts";
import { FfmpegService } from "./ffmpeg.service";

@Injectable()
@Processor("video")
export class VideoProcessorService extends BaseProcessorService<typeof videoJobContracts> {
  constructor(
    @InjectQueue("video") queue: Queue,
    private readonly ffmpeg: FfmpegService,
  ) {
    super("video", queue, videoJobContracts);
  }

  protected getHandlers(): JobHandlers<typeof videoJobContracts> {
    return {
      transcode: async ({ data, progress, log }) => {
        log(`Transcoding video ${data.videoId} to ${data.outputFormat}`);
        
        await progress(0);
        
        // Simulate transcoding with progress
        for (let i = 10; i <= 90; i += 10) {
          await this.ffmpeg.transcodeChunk(data.inputPath, i);
          await progress(i);
        }
        
        const result = await this.ffmpeg.finalize(data.inputPath, data.outputFormat);
        await progress(100);
        
        return {
          outputPath: result.path,
          duration: result.duration,
          size: result.size,
          format: data.outputFormat,
        };
      },

      thumbnail: async ({ data, log }) => {
        log(`Generating thumbnails for video ${data.videoId}`);
        
        const thumbnails = await Promise.all(
          data.timestamps.map(async (ts) => ({
            timestamp: ts,
            path: await this.ffmpeg.extractFrame(data.videoPath, ts),
          })),
        );
        
        return { thumbnails };
      },
    };
  }

  @Process("transcode")
  async processTranscode(job: Job) {
    return this.processJob(job);
  }

  @Process("thumbnail")
  async processThumbnail(job: Job) {
    return this.processJob(job);
  }

  // Bull event handlers
  @OnQueueCompleted()
  onCompleted(job: Job, result: unknown) {
    this.logger.log(`Job ${job.name} (${job.id}) completed`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.name} (${job.id}) failed: ${error.message}`);
  }
}
```

### 3. Module Registration

```typescript
// video.module.ts
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";
import { VideoProcessorService } from "./video-processor.service";
import { VideoService } from "./video.service";
import { FfmpegService } from "./ffmpeg.service";

@Module({
  imports: [
    BullModule.registerQueue({
      name: "video",
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    }),
  ],
  providers: [VideoProcessorService, VideoService, FfmpegService],
  exports: [VideoProcessorService, VideoService],
})
export class VideoModule {}
```

### 4. Usage in Service

```typescript
// video.service.ts
import { Injectable } from "@nestjs/common";
import { VideoProcessorService } from "./video-processor.service";

@Injectable()
export class VideoService {
  constructor(private readonly processor: VideoProcessorService) {}

  async uploadAndProcess(videoId: string, filePath: string) {
    // Add transcode job
    const transcodeJob = await this.processor.addJob("transcode", {
      videoId,
      inputPath: filePath,
      outputFormat: "mp4",
      quality: "high",
    });

    // Add thumbnail job with lower priority
    const thumbnailJob = await this.processor.addJob("thumbnail", {
      videoId,
      videoPath: filePath,
      timestamps: [0, 15, 30, 60],
    });

    return {
      transcodeJobId: transcodeJob.jobId,
      thumbnailJobId: thumbnailJob.jobId,
    };
  }

  async getProcessingStatus(jobId: string) {
    const job = await this.processor.getJob(jobId);
    if (!job) return null;

    return {
      state: await job.getState(),
      progress: job.progress(),
      data: job.data,
      result: job.returnvalue,
      failedReason: job.failedReason,
    };
  }
}
```

---

## Type Safety

### Compile-Time Safety

TypeScript will catch type errors at compile time:

```typescript
// ❌ TypeScript Error: Property 'wrongField' does not exist
await processor.addJob("deploy", { wrongField: "123" });

// ❌ TypeScript Error: Type '"invalid"' is not assignable to type '"github" | "gitlab" | "git" | "upload"'
await processor.addJob("deploy", {
  deploymentId: "123",
  serviceId: "456",
  projectId: "789",
  sourceConfig: { type: "invalid" },  // Error!
});

// ✅ Valid
await processor.addJob("deploy", {
  deploymentId: "123",
  serviceId: "456",
  projectId: "789",
  sourceConfig: { type: "github" },
});
```

### Runtime Validation

Zod validates data at runtime:

```typescript
// Throws JobValidationError at runtime if validation fails
await processor.addJob("deploy", {
  deploymentId: "",  // ❌ Runtime error if schema has min length
  // ...
});
```

---

## Error Handling

### Validation Errors

```typescript
import { JobValidationError, JobResultValidationError } from "@/core/modules/jobs";

try {
  await processor.addJob("deploy", invalidData);
} catch (error) {
  if (error instanceof JobValidationError) {
    console.error(`Validation failed for job '${error.jobName}'`);
    console.error(error.zodError.issues);
  }
}
```

### Job Failure Handling

```typescript
@OnQueueFailed()
onFailed(job: Job, error: Error) {
  if (error instanceof JobValidationError) {
    // Input validation failed
    this.logger.error(`Job ${job.id} had invalid input: ${error.message}`);
  } else if (error instanceof JobResultValidationError) {
    // Handler returned invalid result
    this.logger.error(`Job ${job.id} returned invalid result: ${error.message}`);
  } else {
    // Application error
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }
}
```

---

## Testing

```typescript
import { Test } from "@nestjs/testing";
import { BullModule, getQueueToken } from "@nestjs/bull";
import type { Queue } from "bull";
import { VideoProcessorService } from "./video-processor.service";

describe("VideoProcessorService", () => {
  let processor: VideoProcessorService;
  let queue: Queue;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        BullModule.registerQueue({ name: "video" }),
      ],
      providers: [VideoProcessorService],
    }).compile();

    processor = module.get(VideoProcessorService);
    queue = module.get(getQueueToken("video"));
  });

  afterEach(async () => {
    await queue.empty();
  });

  it("should add job with valid data", async () => {
    const result = await processor.addJob("transcode", {
      videoId: "test-123",
      inputPath: "/tmp/video.mp4",
      outputFormat: "webm",
    });

    expect(result.jobId).toBeDefined();
    expect(result.queueName).toBe("video");
    expect(result.jobName).toBe("transcode");
  });

  it("should reject invalid job data", async () => {
    await expect(
      processor.addJob("transcode", {
        videoId: "test-123",
        inputPath: "/tmp/video.mp4",
        outputFormat: "invalid-format" as any,  // Invalid
      }),
    ).rejects.toThrow(JobValidationError);
  });

  it("should validate job data without adding", () => {
    const result = processor.validateJobData("transcode", {
      videoId: "test-123",
      inputPath: "/tmp/video.mp4",
      outputFormat: "mp4",
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.outputFormat).toBe("mp4");
    }
  });

  it("should get queue statistics", async () => {
    const stats = await processor.getQueueStats();
    
    expect(stats).toHaveProperty("waiting");
    expect(stats).toHaveProperty("active");
    expect(stats).toHaveProperty("completed");
    expect(stats).toHaveProperty("failed");
  });
});
```

---

## Best Practices

1. **Use descriptive job names**: `deploy`, `cleanup`, `transcode`, `sendEmail`

2. **Set appropriate timeouts**: Long-running jobs need longer timeouts
   ```typescript
   .timeout(600000)  // 10 minutes for heavy processing
   ```

3. **Configure retry wisely**: Not all jobs should retry
   ```typescript
   // Idempotent jobs can retry safely
   .retry({ attempts: 3, backoff: BackoffStrategy.EXPONENTIAL })
   
   // Non-idempotent jobs should not retry
   // (don't set retry, or set attempts: 0)
   ```

4. **Use progress updates**: Keep users informed for long jobs
   ```typescript
   await progress(25);  // 25% complete
   ```

5. **Log meaningful messages**: Use the `log` helper in handlers
   ```typescript
   log(`Processing item ${data.id} of ${data.total}`);
   ```

6. **Handle cleanup**: Clean old jobs to save memory
   ```typescript
   .removeOnComplete(50)   // Keep last 50 completed
   .removeOnFail(100)      // Keep last 100 failed for debugging
   ```

7. **Use `satisfies JobContracts`**: Ensures type safety when defining contracts
   ```typescript
   export const myContracts = {
     job1: contract1,
     job2: contract2,
   } satisfies JobContracts;
   ```

8. **Group related jobs**: Keep related contracts together
   ```typescript
   export const deploymentContracts = { deploy, rollback, cleanup };
   export const videoContracts = { transcode, thumbnail, analyze };
   ```

---

## Migration from Untyped Processors

To migrate an existing Bull processor:

### Before (Untyped)

```typescript
@Processor("deployment")
export class DeploymentProcessor {
  @Process("deploy")
  async handleDeploy(job: Job<any>) {
    const { deploymentId, serviceId } = job.data;
    // No type safety, no validation
  }
}
```

### After (Type-safe)

```typescript
// 1. Define contracts
const deploymentContracts = {
  deploy: jobContractBuilder()
    .data(z.object({
      deploymentId: z.string(),
      serviceId: z.string(),
    }))
    .result(z.object({
      success: z.boolean(),
    }))
    .build(),
} satisfies JobContracts;

// 2. Extend BaseProcessorService
@Processor("deployment")
export class DeploymentProcessor extends BaseProcessorService<typeof deploymentContracts> {
  constructor(@InjectQueue("deployment") queue: Queue) {
    super("deployment", queue, deploymentContracts);
  }

  protected getHandlers(): JobHandlers<typeof deploymentContracts> {
    return {
      deploy: async ({ data }) => {
        // Full type safety: data.deploymentId is string
        return { success: true };
      },
    };
  }

  @Process("deploy")
  async handleDeploy(job: Job) {
    return this.processJob(job);  // Validates automatically
  }
}
```

---

## Jobs with Events Integration

Jobs can emit type-safe events during processing. This allows subscribers to receive real-time progress updates.

### Defining Jobs with Events

Use the `.events()` method in the contract builder to define event output schema:

```typescript
import { jobContractBuilder, JobContracts, JobPriority, ProcessingStrategy } from "@/core/modules/jobs";
import { z } from "zod";

const deployContract = jobContractBuilder()
  .data(z.object({
    deploymentId: z.string(),
    serviceId: z.string(),
  }))
  .result(z.object({
    success: z.boolean(),
    containerId: z.string().optional(),
  }))
  // Add events with the nested builder
  .events()
    .output(z.object({
      progress: z.number().min(0).max(100),
      status: z.string(),
      stage: z.enum(["init", "building", "deploying", "cleanup", "done"]),
    }))
    .strategy(ProcessingStrategy.PARALLEL)
    .build()  // Returns back to job builder
  .priority(JobPriority.HIGH)
  .build();

export const deploymentContracts = {
  deploy: deployContract,
} satisfies JobContracts;
```

### Creating Processor with Event Service

When a job has events defined, pass an event service to the processor:

```typescript
import { Injectable } from "@nestjs/common";
import { Processor, Process, InjectQueue } from "@nestjs/bull";
import type { Queue, Job } from "bull";
import { BaseProcessorService, JobHandlers } from "@/core/modules/jobs";
import { deploymentContracts } from "./deployment.contracts";
import { DeploymentEventService } from "./deployment-event.service";

@Injectable()
@Processor("deployment")
export class DeploymentProcessorService extends BaseProcessorService<typeof deploymentContracts> {
  constructor(
    @InjectQueue("deployment") queue: Queue,
    private readonly deploymentEvents: DeploymentEventService,
    private readonly orchestrator: DeploymentOrchestrator,
  ) {
    // Pass event service as 4th parameter
    super("deployment", queue, deploymentContracts, deploymentEvents);
  }

  protected getHandlers(): JobHandlers<typeof deploymentContracts> {
    return {
      // Handler receives typed `emit` function when contract has events
      deploy: async ({ data, progress, log, emit }) => {
        log(`Starting deployment ${data.deploymentId}`);
        
        // Type-safe emit - TypeScript validates the event shape
        emit({ progress: 0, status: "Initializing", stage: "init" });
        
        await progress(10);
        emit({ progress: 10, status: "Building image", stage: "building" });
        
        const image = await this.orchestrator.buildImage(data.serviceId);
        await progress(50);
        emit({ progress: 50, status: "Deploying container", stage: "deploying" });
        
        const result = await this.orchestrator.deploy(image);
        await progress(90);
        emit({ progress: 90, status: "Cleaning up", stage: "cleanup" });
        
        emit({ progress: 100, status: "Completed", stage: "done" });
        
        return {
          success: true,
          containerId: result.containerId,
        };
      },
    };
  }

  @Process("deploy")
  async processDeploy(job: Job) {
    return this.processJob(job);
  }
}
```

### Subscribing to Job Events

Use the event service to subscribe to job progress events:

```typescript
import { Injectable } from "@nestjs/common";
import { DeploymentEventService } from "./deployment-event.service";

@Injectable()
export class DeploymentMonitorService {
  constructor(private readonly events: DeploymentEventService) {}

  async watchDeployment(deploymentId: string, serviceId: string) {
    // Subscribe to deployment events
    const subscription = this.events.subscribe("deploy", {
      deploymentId,
      serviceId,
    });

    // Process events as they arrive
    for await (const event of subscription) {
      console.log(`[${event.stage}] ${event.progress}% - ${event.status}`);
      
      if (event.stage === "done") {
        break;
      }
    }
  }
}
```

### Event Flow

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│   Job Added         │     │  Processor          │     │  Subscriber         │
│                     │     │                     │     │                     │
│  addJob("deploy",   │────▶│  processJob()       │     │  subscribe("deploy" │
│    { ... })         │     │    │                │     │    { ... })         │
│                     │     │    ▼                │     │    │                │
│                     │     │  handler({ emit })  │────▶│    ▼                │
│                     │     │    emit({...})      │     │  for await (event)  │
│                     │     │    emit({...})      │────▶│    process(event)   │
│                     │     │    emit({...})      │────▶│    process(event)   │
│                     │     │    return result    │     │                     │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
```

### Type Safety

The `emit` function is fully typed based on the contract's event schema:

```typescript
// ❌ TypeScript Error: Property 'wrongField' does not exist
emit({ wrongField: "value" });

// ❌ TypeScript Error: Type '"invalid"' is not assignable to '"init" | "building" | ...'
emit({ progress: 50, status: "Test", stage: "invalid" });

// ✅ Valid - all fields match the schema
emit({ progress: 50, status: "Building", stage: "building" });
```

### Jobs Without Events

If a job doesn't define events, the `emit` function is not available in the handler:

```typescript
const cleanupContract = jobContractBuilder()
  .data(z.object({ deploymentId: z.string() }))
  .result(z.object({ cleaned: z.boolean() }))
  // No .events() call
  .build();

// Handler doesn't receive emit function
const cleanupHandler = async ({ data, log }) => {
  // emit is not available here
  log(`Cleaning ${data.deploymentId}`);
  return { cleaned: true };
};
```

---

## Related Resources

- [Bull Documentation](https://docs.bullmq.io/) - Queue system documentation
- [NestJS Bull Module](https://docs.nestjs.com/techniques/queues) - NestJS integration
- [Zod Documentation](https://zod.dev/) - Schema validation
- [Events Module](../events/docs/README.md) - Related contract-based event system
