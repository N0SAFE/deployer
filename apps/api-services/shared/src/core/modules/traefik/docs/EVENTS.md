# Event System Integration

> **Last Updated**: 2025-11-29

## Overview

The Traefik module integrates with the core Events module to provide real-time updates for configuration changes, synchronization progress, and validation results.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     TraefikEventService                         │
│  extends BaseEventService                                       │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  Event Contracts                                           │ │
│  │  - configSync (sync progress)                              │ │
│  │  - configChange (CRUD operations)                          │ │
│  │  - validationResult (validation feedback)                  │ │
│  └───────────────────────────────────────────────────────────┘ │
│                              │                                  │
│                              ▼                                  │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  Processing Strategies                                     │ │
│  │  - ABORT: New request cancels in-progress                  │ │
│  │  - QUEUE: Sequential processing                            │ │
│  │  - PARALLEL: Concurrent processing                         │ │
│  │  - IGNORE: Skip if already processing                      │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Transport Layer                            │
│  AsyncIterator → SSE/WebSocket → Clients                        │
└─────────────────────────────────────────────────────────────────┘
```

## Event Contracts

Event contracts define the input/output types for each event type using Zod schemas.

### configSync Contract

Tracks synchronization progress.

```typescript
import { contractBuilder } from '@/core/modules/events/event-contract.builder';
import { z } from 'zod';

export const configSyncContract = contractBuilder('configSync')
  .input(z.object({
    configId: z.string().optional(),
    projectId: z.string().optional(),
    serviceId: z.string().optional()
  }))
  .output(z.object({
    status: z.enum(['started', 'progress', 'complete', 'error']),
    configId: z.string().optional(),
    current: z.number().optional(),
    total: z.number().optional(),
    path: z.string().optional(),
    error: z.string().optional(),
    timestamp: z.string()
  }))
  .build();
```

### configChange Contract

Notifies of configuration modifications.

```typescript
export const configChangeContract = contractBuilder('configChange')
  .input(z.object({
    configId: z.string().optional(),
    projectId: z.string().optional()
  }))
  .output(z.object({
    action: z.enum(['created', 'updated', 'deleted']),
    configId: z.string(),
    configType: z.enum(['service', 'middleware', 'certificate', 'template']),
    projectId: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    timestamp: z.string()
  }))
  .build();
```

### validationResult Contract

Delivers validation feedback.

```typescript
export const validationResultContract = contractBuilder('validationResult')
  .input(z.object({
    configId: z.string()
  }))
  .output(z.object({
    configId: z.string(),
    isValid: z.boolean(),
    errors: z.array(z.object({
      path: z.string(),
      code: z.string(),
      message: z.string()
    })),
    warnings: z.array(z.object({
      path: z.string(),
      code: z.string(),
      message: z.string()
    })),
    timestamp: z.string()
  }))
  .build();
```

## TraefikEventService Implementation

```typescript
import { Injectable } from '@nestjs/common';
import { BaseEventService, ProcessingStrategy } from '@/core/modules/events/base-event.service';
import { 
  configSyncContract, 
  configChangeContract, 
  validationResultContract 
} from './contracts';

@Injectable()
export class TraefikEventService extends BaseEventService {
  constructor() {
    super();
    
    // Register contracts
    this.registerContract(configSyncContract, ProcessingStrategy.QUEUE);
    this.registerContract(configChangeContract, ProcessingStrategy.PARALLEL);
    this.registerContract(validationResultContract, ProcessingStrategy.ABORT);
  }

  // Type-safe emit methods
  emitSyncStarted(input: { configId?: string; projectId?: string }, total: number) {
    return this.emit('configSync', input, {
      status: 'started',
      total,
      timestamp: new Date().toISOString()
    });
  }

  emitSyncProgress(input: { configId?: string }, current: number, total: number, path: string) {
    return this.emit('configSync', input, {
      status: 'progress',
      current,
      total,
      path,
      timestamp: new Date().toISOString()
    });
  }

  emitSyncComplete(input: { configId?: string; projectId?: string }, total: number) {
    return this.emit('configSync', input, {
      status: 'complete',
      total,
      timestamp: new Date().toISOString()
    });
  }

  emitSyncError(input: { configId?: string }, error: string) {
    return this.emit('configSync', input, {
      status: 'error',
      error,
      timestamp: new Date().toISOString()
    });
  }

  emitConfigCreated(configId: string, configType: string, projectId?: string) {
    return this.emit('configChange', { configId, projectId }, {
      action: 'created',
      configId,
      configType,
      projectId,
      timestamp: new Date().toISOString()
    });
  }

  emitConfigUpdated(configId: string, configType: string, projectId?: string) {
    return this.emit('configChange', { configId, projectId }, {
      action: 'updated',
      configId,
      configType,
      projectId,
      timestamp: new Date().toISOString()
    });
  }

  emitConfigDeleted(configId: string, configType: string, projectId?: string) {
    return this.emit('configChange', { configId, projectId }, {
      action: 'deleted',
      configId,
      configType,
      projectId,
      timestamp: new Date().toISOString()
    });
  }

  emitValidationResult(configId: string, isValid: boolean, errors: any[], warnings: any[]) {
    return this.emit('validationResult', { configId }, {
      configId,
      isValid,
      errors,
      warnings,
      timestamp: new Date().toISOString()
    });
  }
}
```

## Usage in Services

### TraefikSyncService Integration

```typescript
@Injectable()
export class TraefikSyncService {
  constructor(
    private readonly repository: TraefikRepository,
    private readonly eventService: TraefikEventService
  ) {}

  async syncAllConfigurations(): Promise<SyncResult> {
    const configs = await this.repository.getTraefikConfigsNeedingSync();
    
    // Emit start event
    this.eventService.emitSyncStarted({}, configs.length);
    
    let synced = 0;
    let failed = 0;
    
    for (let i = 0; i < configs.length; i++) {
      try {
        const config = configs[i];
        await this.syncServiceConfiguration(config.id);
        synced++;
        
        // Emit progress event
        this.eventService.emitSyncProgress(
          { configId: config.id },
          i + 1,
          configs.length,
          config.path
        );
      } catch (error) {
        failed++;
        this.eventService.emitSyncError(
          { configId: configs[i].id },
          error.message
        );
      }
    }
    
    // Emit complete event
    this.eventService.emitSyncComplete({}, synced);
    
    return { total: configs.length, synced, failed };
  }
}
```

### TraefikService Integration

```typescript
@Injectable()
export class TraefikService {
  constructor(
    private readonly repository: TraefikRepository,
    private readonly eventService: TraefikEventService,
    private readonly validationService: TraefikValidationService
  ) {}

  async createServiceConfiguration(data: CreateServiceConfigDto): Promise<ServiceConfig> {
    // Create in database
    const config = await this.repository.createServiceConfig(data);
    
    // Validate
    const validation = await this.validationService.validateConfig(config.config.toYAML());
    this.eventService.emitValidationResult(
      config.id,
      validation.isValid,
      validation.errors,
      validation.warnings
    );
    
    // Emit change event
    this.eventService.emitConfigCreated(config.id, 'service', config.projectId);
    
    return config;
  }

  async updateServiceConfiguration(id: string, data: UpdateServiceConfigDto): Promise<ServiceConfig> {
    const config = await this.repository.updateServiceConfig(id, data);
    
    // Emit change event
    this.eventService.emitConfigUpdated(config.id, 'service', config.projectId);
    
    return config;
  }

  async deleteServiceConfiguration(id: string): Promise<void> {
    const config = await this.repository.getServiceConfig(id);
    await this.repository.deleteServiceConfig(id);
    
    // Emit change event
    this.eventService.emitConfigDeleted(id, 'service', config?.projectId);
  }
}
```

## Subscribing to Events

### In Controllers (SSE Endpoint)

```typescript
@Controller('traefik')
export class TraefikController {
  constructor(private readonly eventService: TraefikEventService) {}

  @Sse('events/sync')
  syncEvents(@Query() query: { configId?: string; projectId?: string }) {
    const subscription = this.eventService.subscribe('configSync', query);
    
    return new Observable(observer => {
      (async () => {
        for await (const event of subscription) {
          observer.next({ data: event });
        }
        observer.complete();
      })();
    });
  }

  @Sse('events/changes')
  changeEvents(@Query() query: { projectId?: string }) {
    const subscription = this.eventService.subscribe('configChange', query);
    
    return new Observable(observer => {
      (async () => {
        for await (const event of subscription) {
          observer.next({ data: event });
        }
        observer.complete();
      })();
    });
  }
}
```

### In Frontend (React Example)

```typescript
// React hook for traefik events
function useTraefikSyncEvents(configId?: string) {
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [status, setStatus] = useState<'idle' | 'syncing' | 'complete' | 'error'>('idle');
  
  useEffect(() => {
    const params = new URLSearchParams();
    if (configId) params.set('configId', configId);
    
    const eventSource = new EventSource(`/api/traefik/events/sync?${params}`);
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setEvents(prev => [...prev, data]);
      setStatus(data.status);
    };
    
    eventSource.onerror = () => {
      setStatus('error');
      eventSource.close();
    };
    
    return () => eventSource.close();
  }, [configId]);
  
  return { events, status };
}
```

## Processing Strategies

### QUEUE Strategy

Events are processed sequentially. Used for sync events to prevent race conditions.

```typescript
// configSync uses QUEUE
this.registerContract(configSyncContract, ProcessingStrategy.QUEUE);

// Result: Events processed one at a time in order
// Event 1 starts → Event 1 completes → Event 2 starts → ...
```

### PARALLEL Strategy

Events are processed concurrently. Used for change notifications.

```typescript
// configChange uses PARALLEL
this.registerContract(configChangeContract, ProcessingStrategy.PARALLEL);

// Result: Multiple events can be processed simultaneously
// Event 1 starts → Event 2 starts → Event 1 completes → Event 2 completes
```

### ABORT Strategy

New events cancel any in-progress events. Used for validation where only latest matters.

```typescript
// validationResult uses ABORT
this.registerContract(validationResultContract, ProcessingStrategy.ABORT);

// Result: Only most recent event matters
// Event 1 starts → Event 2 starts → Event 1 ABORTED → Event 2 completes
```

### IGNORE Strategy

New events are ignored if one is in progress. Not currently used in Traefik module.

```typescript
// Example usage
this.registerContract(someContract, ProcessingStrategy.IGNORE);

// Result: Skip if busy
// Event 1 starts → Event 2 SKIPPED → Event 1 completes
```

## Event Filtering

Events can be filtered by input parameters.

```typescript
// Subscribe to specific config
const sub1 = eventService.subscribe('configSync', { configId: 'cfg_123' });

// Subscribe to all project events
const sub2 = eventService.subscribe('configChange', { projectId: 'proj_456' });

// Subscribe to all events (no filter)
const sub3 = eventService.subscribe('configSync', {});
```

## Best Practices

### 1. Always Emit Events for State Changes

```typescript
// ✅ Good: Emit events for observability
await this.repository.createServiceConfig(data);
this.eventService.emitConfigCreated(config.id, 'service', projectId);

// ❌ Bad: Silent operation
await this.repository.createServiceConfig(data);
```

### 2. Use Appropriate Strategy

```typescript
// ✅ Good: QUEUE for operations that must not overlap
this.registerContract(syncContract, ProcessingStrategy.QUEUE);

// ✅ Good: ABORT for "latest wins" scenarios
this.registerContract(validationContract, ProcessingStrategy.ABORT);

// ❌ Bad: Using PARALLEL for sync operations
this.registerContract(syncContract, ProcessingStrategy.PARALLEL); // Race condition!
```

### 3. Include Timestamps

```typescript
// ✅ Good: Always include timestamp
this.emit('configChange', input, {
  action: 'updated',
  timestamp: new Date().toISOString()
});

// ❌ Bad: No timestamp
this.emit('configChange', input, { action: 'updated' });
```

### 4. Handle Subscription Cleanup

```typescript
// ✅ Good: Clean up subscriptions
useEffect(() => {
  const eventSource = new EventSource(url);
  return () => eventSource.close(); // Cleanup!
}, []);

// ❌ Bad: Memory leak
useEffect(() => {
  const eventSource = new EventSource(url);
  // No cleanup!
}, []);
```

### 5. Filter at Subscribe Time

```typescript
// ✅ Good: Filter in subscription
const sub = eventService.subscribe('configChange', { projectId });

// ❌ Bad: Filter after receiving
const sub = eventService.subscribe('configChange', {});
for await (const event of sub) {
  if (event.projectId === projectId) { ... } // Wasteful
}
```

## Module Registration

```typescript
// traefik.module.ts
@Module({
  imports: [EventsModule],
  providers: [
    TraefikEventService,
    TraefikService,
    TraefikSyncService,
    // ... other providers
  ],
  exports: [TraefikEventService]
})
export class TraefikCoreModule {}
```
