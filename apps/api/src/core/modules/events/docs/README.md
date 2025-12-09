# Events Module

> **Type**: Core Infrastructure Module  
> **Last Updated**: 2025-11-30

## Overview

The Events module provides a **contract-based event system** for type-safe, real-time event subscription and emission. It uses Zod schemas for input/output validation and supports multiple processing strategies (PARALLEL, QUEUE, ABORT, IGNORE) to handle concurrent operations elegantly.

**Key Features:**
- 🔒 **Type-safe**: Full TypeScript inference from Zod schemas
- 🔄 **Multiple strategies**: Handle concurrent operations with PARALLEL, QUEUE, ABORT, or IGNORE
- ✅ **Validation**: Automatic input/output validation via Zod
- 📡 **Async Iterator**: Modern async iteration pattern for subscriptions
- 🎯 **Abort support**: Built-in AbortController integration for cancellable operations

## Architecture

```
events/
├── events.module.ts           # NestJS module definition
├── base-event.service.ts      # Abstract base class for event services
├── event-contract.builder.ts  # Contract builder and types
├── index.ts                   # Re-exports
└── docs/
    └── README.md              # This documentation
```

## Quick Start

### Step 1: Define Event Contracts

Contracts define the shape of your events using Zod schemas. Each contract has:
- **input**: Parameters to identify the event stream (e.g., `videoId`, `userId`)
- **output**: The data structure emitted to subscribers
- **strategy**: How to handle concurrent operations (optional, defaults to PARALLEL)

```typescript
import { contractBuilder, ProcessingStrategy } from "@/core/modules/events";
import { z } from "zod";

// Define your event contracts
const videoProcessingContract = contractBuilder()
  .input(
    z.object({
      videoId: z.string().describe("Video ID being processed"),
    })
  )
  .output(
    z.object({
      progress: z.number().min(0).max(100).describe("Processing progress"),
      message: z.string().describe("Status message"),
      metadata: z
        .object({
          duration: z.number(),
          width: z.number(),
          height: z.number(),
          codec: z.string(),
        })
        .optional()
        .describe("Video metadata (available on completion)"),
      timestamp: z.string().describe("Event timestamp"),
    })
  )
  .strategy(ProcessingStrategy.ABORT) // New request aborts previous
  .build();

// Group related contracts
const presentationContracts = {
  videoProcessing: videoProcessingContract,
} as const;
```

### Step 2: Create Event Service

Extend `BaseEventService` with your contracts:

```typescript
import { Injectable } from "@nestjs/common";
import { BaseEventService } from "@/core/modules/events";

@Injectable()
export class PresentationEventService extends BaseEventService<typeof presentationContracts> {
  constructor() {
    super("presentation", presentationContracts);
    //     ^ prefix for event names
  }
}
```

### Step 3: Register in Module

```typescript
import { Module } from "@nestjs/common";
import { PresentationEventService } from "./presentation-event.service";
import { PresentationService } from "./presentation.service";

@Module({
  providers: [PresentationEventService, PresentationService],
  exports: [PresentationEventService],
})
export class PresentationModule {}
```

### Step 4: Start Processing (Emit Events)

Use `startProcessing()` to run operations with strategy handling:

```typescript
import { Injectable } from "@nestjs/common";
import { PresentationEventService } from "./presentation-event.service";

@Injectable()
export class PresentationService {
  constructor(private readonly presentationEventService: PresentationEventService) {}

  async processVideo(videoId: string) {
    // Start processing with ABORT strategy
    // If a new request comes in, the previous one is automatically aborted
    this.presentationEventService.startProcessing(
      "videoProcessing",
      { videoId },
      async ({ abortSignal, emit }) => {
        try {
          // Initial progress
          emit({
            progress: 0,
            message: "Starting video processing...",
            timestamp: new Date().toISOString(),
          });

          // Check abort signal before expensive operations
          if (abortSignal?.aborted) return;

          // Simulate processing phases
          for (let i = 10; i <= 100; i += 10) {
            // Check if operation was aborted
            if (abortSignal?.aborted) {
              emit({
                progress: i,
                message: "Processing aborted",
                timestamp: new Date().toISOString(),
              });
              return;
            }

            await this.processChunk(videoId, i);

            emit({
              progress: i,
              message: i < 100 ? `Processing... ${i}%` : "Complete!",
              metadata: i === 100 ? { duration: 120, width: 1920, height: 1080, codec: "h264" } : undefined,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (error) {
          emit({
            progress: 0,
            message: `Error: ${error.message}`,
            timestamp: new Date().toISOString(),
          });
        }
      }
    );
  }

  private async processChunk(videoId: string, progress: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
```

### Step 5: Subscribe to Events

Subscribe using async iterators:

```typescript
// In a controller or service
const subscription = this.presentationEventService.subscribe(
  "videoProcessing",
  { videoId: "video-123" }
);

// Consume events
for await (const event of subscription) {
  console.log(`Progress: ${event.progress}%, Message: ${event.message}`);
  
  if (event.progress === 100) {
    break; // Done processing
  }
}
```

---

## Processing Strategies

### PARALLEL (Default)

Run all operations simultaneously. Each call to `startProcessing` runs independently.

```typescript
const contract = contractBuilder()
  .input(z.object({ id: z.string() }))
  .output(z.object({ data: z.string() }))
  .strategy(ProcessingStrategy.PARALLEL)
  .build();
```

**Use cases:**
- Independent events that don't conflict
- Logging and analytics
- Multiple independent subscribers

### QUEUE

Process operations sequentially. New requests wait for previous ones to complete.

```typescript
const contract = contractBuilder()
  .input(z.object({ id: z.string() }))
  .output(z.object({ data: z.string() }))
  .strategy(ProcessingStrategy.QUEUE, {
    onQueue: (input, position) => {
      console.log(`Queued at position ${position}`);
    },
  })
  .build();
```

**Use cases:**
- Order-dependent operations
- Resource-limited processing (e.g., one file upload at a time)
- Sequential database operations

### ABORT

Cancel the previous operation when a new one starts. Provides `AbortSignal` to the handler.

```typescript
const contract = contractBuilder()
  .input(z.object({ id: z.string() }))
  .output(z.object({ data: z.string() }))
  .strategy(ProcessingStrategy.ABORT, {
    onAbort: (input, { signal, abortController }) => {
      console.log(`Aborting operation for ${input.id}`);
    },
  })
  .build();
```

**Use cases:**
- User-triggered updates (e.g., search-as-you-type)
- Video/audio processing where only latest matters
- Real-time preview generation
- Singleton operations (only one can run at a time)

### IGNORE

Skip new requests while one is already processing. First operation wins.

```typescript
const contract = contractBuilder()
  .input(z.object({ id: z.string() }))
  .output(z.object({ data: z.string() }))
  .strategy(ProcessingStrategy.IGNORE, {
    onIgnore: (input) => {
      console.log(`Ignoring duplicate request for ${input.id}`);
    },
  })
  .build();
```

**Use cases:**
- Debouncing expensive operations
- Preventing duplicate submissions
- Rate limiting

---

## API Reference

### BaseEventService Methods

#### `subscribe<K>(eventName, input): AsyncIterableIterator`

Subscribe to an event stream.

```typescript
const subscription = service.subscribe("eventName", { id: "123" });

for await (const data of subscription) {
  // Handle each event
}
```

#### `emit<K>(eventName, input, output): void`

Emit a single event to all subscribers.

```typescript
service.emit(
  "eventName",
  { id: "123" },           // Input (identifies the stream)
  { progress: 50 }         // Output (the data to emit)
);
```

#### `startProcessing<K>(eventName, input, handler): Promise<void>`

Start a processing operation with strategy handling.

```typescript
await service.startProcessing(
  "eventName",
  { id: "123" },
  async ({ abortSignal, input, emit }) => {
    // Your processing logic
    emit({ progress: 100 });
  }
);
```

#### `hasSubscribers<K>(eventName, input): boolean`

Check if an event has active subscribers.

```typescript
if (service.hasSubscribers("eventName", { id: "123" })) {
  // Someone is listening
}
```

#### `getSubscriberCount<K>(eventName, input): number`

Get the number of active subscribers.

```typescript
const count = service.getSubscriberCount("eventName", { id: "123" });
```

#### `isProcessing<K>(eventName, input): boolean`

Check if an operation is currently processing.

```typescript
if (service.isProcessing("eventName", { id: "123" })) {
  // Operation in progress
}
```

#### `getQueueLength<K>(eventName, input): number`

Get the number of queued operations (QUEUE strategy only).

```typescript
const queueLength = service.getQueueLength("eventName", { id: "123" });
```

#### `removeAllSubscribers<K>(eventName, input): void`

Remove all subscribers for an event (cleanup).

```typescript
service.removeAllSubscribers("eventName", { id: "123" });
```

#### `getActiveEvents(): string[]`

Get all active event names.

```typescript
const activeEvents = service.getActiveEvents();
// ["presentation:videoProcessing:video-123", ...]
```

#### `clearAll(): void`

Clear all events, subscriptions, and abort active operations.

```typescript
service.clearAll();
```

---

## Complete Example: Video Processing Service

Here's a full example showing all concepts together:

### 1. Contracts Definition

```typescript
// presentation-event.contracts.ts
import { contractBuilder, ProcessingStrategy } from "@/core/modules/events";
import { z } from "zod";

export const videoProcessingContract = contractBuilder()
  .input(
    z.object({
      videoId: z.string().describe("Video ID being processed"),
    })
  )
  .output(
    z.object({
      progress: z.number().min(0).max(100),
      message: z.string(),
      metadata: z.object({
        duration: z.number(),
        width: z.number(),
        height: z.number(),
        codec: z.string(),
      }).optional(),
      timestamp: z.string(),
    })
  )
  .strategy(ProcessingStrategy.ABORT, {
    onAbort: (input, { signal }) => {
      console.log(`Aborting processing for video ${input.videoId}`);
    },
  })
  .build();

export const presentationContracts = {
  videoProcessing: videoProcessingContract,
} as const;
```

### 2. Event Service

```typescript
// presentation-event.service.ts
import { Injectable } from "@nestjs/common";
import { BaseEventService } from "@/core/modules/events";
import { presentationContracts } from "./presentation-event.contracts";

@Injectable()
export class PresentationEventService extends BaseEventService<typeof presentationContracts> {
  constructor() {
    super("presentation", presentationContracts);
  }
}
```

### 3. Business Service

```typescript
// presentation.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { PresentationEventService } from "./presentation-event.service";

@Injectable()
export class PresentationService {
  private readonly logger = new Logger(PresentationService.name);

  constructor(private readonly eventService: PresentationEventService) {}

  async updatePresentationVideo(presentationId: string, videoFile: Buffer) {
    // Using "singleton" as videoId means only one processing at a time globally
    // Use actual videoId for per-video processing
    this.eventService.startProcessing(
      "videoProcessing",
      { videoId: "singleton" }, // or use actual videoId
      async ({ abortSignal, emit }) => {
        try {
          emit({
            progress: 0,
            message: "Initializing...",
            timestamp: new Date().toISOString(),
          });

          // Step 1: Validate video (10%)
          if (abortSignal?.aborted) return;
          await this.validateVideo(videoFile);
          emit({
            progress: 10,
            message: "Video validated",
            timestamp: new Date().toISOString(),
          });

          // Step 2: Extract metadata (20%)
          if (abortSignal?.aborted) return;
          const metadata = await this.extractMetadata(videoFile);
          emit({
            progress: 20,
            message: "Metadata extracted",
            timestamp: new Date().toISOString(),
          });

          // Step 3: Transcode video (20-90%)
          for (let progress = 30; progress <= 90; progress += 10) {
            if (abortSignal?.aborted) return;
            await this.transcodeChunk(videoFile, progress);
            emit({
              progress,
              message: `Transcoding... ${progress}%`,
              timestamp: new Date().toISOString(),
            });
          }

          // Step 4: Save and finalize (100%)
          if (abortSignal?.aborted) return;
          await this.saveVideo(presentationId, videoFile);
          emit({
            progress: 100,
            message: "Processing complete!",
            metadata,
            timestamp: new Date().toISOString(),
          });

          this.logger.log(`Video processing complete for presentation ${presentationId}`);
        } catch (error) {
          this.logger.error(`Video processing failed: ${error.message}`);
          emit({
            progress: 0,
            message: `Error: ${error.message}`,
            timestamp: new Date().toISOString(),
          });
          throw error;
        }
      }
    );
  }

  private async validateVideo(file: Buffer): Promise<void> {
    await new Promise((r) => setTimeout(r, 200));
  }

  private async extractMetadata(file: Buffer) {
    await new Promise((r) => setTimeout(r, 300));
    return { duration: 120, width: 1920, height: 1080, codec: "h264" };
  }

  private async transcodeChunk(file: Buffer, progress: number): Promise<void> {
    await new Promise((r) => setTimeout(r, 500));
  }

  private async saveVideo(presentationId: string, file: Buffer): Promise<void> {
    await new Promise((r) => setTimeout(r, 200));
  }
}
```

### 4. ORPC Integration (SSE Endpoint)

```typescript
// presentation.router.ts
import { os } from "@orpc/server";
import { z } from "zod";
import { PresentationEventService } from "./presentation-event.service";

export const createPresentationRouter = (eventService: PresentationEventService) => {
  return os.router({
    // SSE endpoint for video processing progress
    videoProcessingProgress: os
      .input(z.object({ videoId: z.string() }))
      .handler(async function* ({ input }) {
        const subscription = eventService.subscribe("videoProcessing", {
          videoId: input.videoId,
        });

        for await (const event of subscription) {
          yield event;

          // End stream when complete
          if (event.progress === 100) {
            break;
          }
        }
      }),
  });
};
```

---

## Event Naming

Events are internally named using the pattern: `{prefix}:{eventName}:{firstInputValue}`

For example:
- Prefix: `presentation`
- Event name: `videoProcessing`
- Input: `{ videoId: "abc-123" }`
- Full event name: `presentation:videoProcessing:abc-123`

You can override `buildFullEventName()` in your service for custom naming:

```typescript
@Injectable()
export class CustomEventService extends BaseEventService<typeof contracts> {
  protected buildFullEventName(eventName: string, input: Record<string, unknown>): string {
    // Custom naming logic
    return `custom:${eventName}:${input.userId}:${input.resourceId}`;
  }
}
```

---

## Type Safety

### Compile-Time Safety

TypeScript will catch type errors at compile time:

```typescript
// ❌ TypeScript Error: Property 'wrongField' does not exist
service.emit("videoProcessing", { wrongField: "123" }, { progress: 50 });

// ❌ TypeScript Error: Type 'string' is not assignable to type 'number'
service.emit("videoProcessing", { videoId: "123" }, { progress: "fifty" });

// ✅ Valid
service.emit("videoProcessing", { videoId: "123" }, { 
  progress: 50, 
  message: "Processing...",
  timestamp: new Date().toISOString()
});
```

### Runtime Validation

Zod validates data at runtime:

```typescript
// Throws ZodError at runtime if validation fails
service.emit("videoProcessing", { videoId: "123" }, { 
  progress: 150,  // ❌ Runtime error: Number must be <= 100
  message: "Done",
  timestamp: new Date().toISOString()
});
```

---

## Testing

```typescript
import { PresentationEventService } from "./presentation-event.service";

describe("PresentationEventService", () => {
  let service: PresentationEventService;

  beforeEach(() => {
    service = new PresentationEventService();
  });

  afterEach(() => {
    service.clearAll();
  });

  it("should emit and receive events", async () => {
    const received: any[] = [];
    const subscription = service.subscribe("videoProcessing", { videoId: "test-123" });

    // Emit after short delay
    setTimeout(() => {
      service.emit("videoProcessing", { videoId: "test-123" }, {
        progress: 50,
        message: "Half done",
        timestamp: new Date().toISOString(),
      });
      service.removeAllSubscribers("videoProcessing", { videoId: "test-123" });
    }, 10);

    for await (const data of subscription) {
      received.push(data);
    }

    expect(received).toHaveLength(1);
    expect(received[0].progress).toBe(50);
  });

  it("should abort previous processing with ABORT strategy", async () => {
    let firstAborted = false;
    let secondCompleted = false;

    // Start first processing (will be aborted)
    const first = service.startProcessing(
      "videoProcessing",
      { videoId: "test-123" },
      async ({ abortSignal, emit }) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (abortSignal?.aborted) {
          firstAborted = true;
          return;
        }
        emit({ progress: 100, message: "First done", timestamp: new Date().toISOString() });
      }
    );

    // Start second processing immediately (should abort first)
    await service.startProcessing(
      "videoProcessing",
      { videoId: "test-123" },
      async ({ emit }) => {
        secondCompleted = true;
        emit({ progress: 100, message: "Second done", timestamp: new Date().toISOString() });
      }
    );

    expect(firstAborted).toBe(true);
    expect(secondCompleted).toBe(true);
  });

  it("should track subscriber count", () => {
    expect(service.getSubscriberCount("videoProcessing", { videoId: "123" })).toBe(0);

    const sub1 = service.subscribe("videoProcessing", { videoId: "123" });
    expect(service.getSubscriberCount("videoProcessing", { videoId: "123" })).toBe(1);

    const sub2 = service.subscribe("videoProcessing", { videoId: "123" });
    expect(service.getSubscriberCount("videoProcessing", { videoId: "123" })).toBe(2);

    service.removeAllSubscribers("videoProcessing", { videoId: "123" });
    expect(service.getSubscriberCount("videoProcessing", { videoId: "123" })).toBe(0);
  });
});
```

---

## Best Practices

1. **Use descriptive event names**: `videoProcessing`, `deploymentProgress`, `fileUpload`

2. **Choose the right strategy**:
   - `PARALLEL` for independent operations
   - `QUEUE` for sequential/ordered operations
   - `ABORT` for user-triggered updates where only latest matters
   - `IGNORE` for debouncing/rate limiting

3. **Always check `abortSignal`**: In ABORT strategy handlers, check `abortSignal?.aborted` before expensive operations

4. **Clean up subscriptions**: Call `removeAllSubscribers()` or `clearAll()` when appropriate

5. **Include timestamps**: Add timestamps to your output schema for debugging and ordering

6. **Use `satisfies EventContracts`**: Ensures type safety when defining contract objects

7. **Singleton pattern**: Use a constant input value (e.g., `{ videoId: "singleton" }`) for operations that should only run one at a time globally

---

## Related Resources

- [ORPC Documentation](https://orpc.io/) - Type-safe RPC framework
- [Zod Documentation](https://zod.dev/) - TypeScript-first schema validation
- [Server-Sent Events (SSE)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [AsyncIterator Protocol](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncIterator)
