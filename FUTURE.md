# Future Features Roadmap

This document outlines planned features and improvements for the NestJS API core infrastructure.

---

## 1. Graceful Shutdown Module

A dedicated module for handling graceful shutdown with request lifecycle management.

### Goals

- Wait for in-flight requests to complete before shutdown
- Cancel long-running operations (deployments, jobs) gracefully
- Configurable timeout for shutdown process
- Hook system for cleanup operations

### Proposed Architecture

```typescript
// core/modules/shutdown/graceful-shutdown.module.ts
@Module({
  providers: [GracefulShutdownService, ShutdownHooksRegistry],
  exports: [GracefulShutdownService, ShutdownHooksRegistry],
})
export class GracefulShutdownModule {}
```

```typescript
// core/modules/shutdown/graceful-shutdown.service.ts
@Injectable()
export class GracefulShutdownService implements OnModuleDestroy {
  private readonly activeRequests = new Set<string>();
  private readonly shutdownHooks: ShutdownHook[] = [];
  private isShuttingDown = false;

  registerRequest(requestId: string): void {
    if (this.isShuttingDown) {
      throw new ServiceUnavailableException('Server is shutting down');
    }
    this.activeRequests.add(requestId);
  }

  completeRequest(requestId: string): void {
    this.activeRequests.delete(requestId);
  }

  registerShutdownHook(hook: ShutdownHook): void {
    this.shutdownHooks.push(hook);
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;
    
    // Wait for active requests with timeout
    await this.waitForActiveRequests(this.config.requestTimeout);
    
    // Execute shutdown hooks (cancel deployments, etc.)
    await this.executeShutdownHooks();
    
    // Final cleanup
    await this.cleanup();
  }

  private async waitForActiveRequests(timeout: number): Promise<void> {
    const deadline = Date.now() + timeout;
    while (this.activeRequests.size > 0 && Date.now() < deadline) {
      await this.delay(100);
    }
    
    if (this.activeRequests.size > 0) {
      this.logger.warn(`Force closing ${this.activeRequests.size} active requests`);
    }
  }
}
```

```typescript
// core/modules/shutdown/shutdown-hook.interface.ts
export interface ShutdownHook {
  name: string;
  priority: number; // Higher = runs first
  onShutdown(): Promise<void>;
}

// Usage in deployment service
@Injectable()
export class DeploymentService implements ShutdownHook {
  name = 'deployment-service';
  priority = 100;

  async onShutdown(): Promise<void> {
    // Cancel all pending deployments
    for (const deployment of this.activeDeployments) {
      await deployment.cancel('Server shutdown');
    }
  }
}
```

### Request Tracking Interceptor

```typescript
// core/interceptors/request-tracking.interceptor.ts
@Injectable()
export class RequestTrackingInterceptor implements NestInterceptor {
  constructor(private readonly shutdownService: GracefulShutdownService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const requestId = context.switchToHttp().getRequest().id;
    
    this.shutdownService.registerRequest(requestId);
    
    return next.handle().pipe(
      finalize(() => this.shutdownService.completeRequest(requestId)),
    );
  }
}
```

---

## 2. Database Transaction Wrapper

A unified transaction management system with automatic rollback and nested transaction support.

### Goals

- Decorator-based transaction management
- Automatic rollback on exceptions
- Nested transaction support (savepoints)
- Transaction context propagation
- Timeout handling

### Proposed Architecture

```typescript
// core/modules/database/transaction.decorator.ts
export function Transactional(options?: TransactionOptions): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const transactionService = this.transactionService as TransactionService;
      
      return transactionService.executeInTransaction(
        () => originalMethod.apply(this, args),
        options,
      );
    };

    return descriptor;
  };
}
```

```typescript
// core/modules/database/transaction.service.ts
@Injectable()
export class TransactionService {
  private readonly transactionContext = new AsyncLocalStorage<DrizzleTransaction>();

  async executeInTransaction<T>(
    callback: () => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const existingTransaction = this.transactionContext.getStore();
    
    // Nested transaction - use savepoint
    if (existingTransaction && options?.propagation !== 'REQUIRES_NEW') {
      return this.executeWithSavepoint(existingTransaction, callback);
    }

    // New transaction
    return this.db.transaction(async (tx) => {
      return this.transactionContext.run(tx, async () => {
        try {
          const result = await this.withTimeout(callback, options?.timeout);
          return result;
        } catch (error) {
          // Transaction will be rolled back automatically by Drizzle
          throw error;
        }
      });
    }, {
      isolationLevel: options?.isolationLevel,
    });
  }

  getCurrentTransaction(): DrizzleTransaction | undefined {
    return this.transactionContext.getStore();
  }

  private async executeWithSavepoint<T>(
    tx: DrizzleTransaction,
    callback: () => Promise<T>,
  ): Promise<T> {
    const savepointName = `sp_${Date.now()}`;
    await tx.execute(sql`SAVEPOINT ${sql.identifier(savepointName)}`);
    
    try {
      return await callback();
    } catch (error) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT ${sql.identifier(savepointName)}`);
      throw error;
    }
  }
}
```

```typescript
// core/modules/database/transaction.types.ts
export interface TransactionOptions {
  isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';
  propagation?: 'REQUIRED' | 'REQUIRES_NEW' | 'NESTED';
  timeout?: number; // milliseconds
  readOnly?: boolean;
}
```

### Usage Example

```typescript
@Injectable()
export class DeploymentService {
  @Transactional({ isolationLevel: 'serializable' })
  async createDeployment(config: DeploymentConfig): Promise<Deployment> {
    const deployment = await this.deploymentRepository.create(config);
    await this.auditService.log('deployment.created', deployment.id);
    await this.notificationService.notify('deployment.started', deployment);
    
    // If any step fails, entire transaction rolls back
    return deployment;
  }
}
```

---

## 3. Redis Caching Layer with Idempotency Support

A comprehensive caching solution with built-in idempotency for safe request retries.

### Goals

- Decorator-based caching
- TTL management with stale-while-revalidate
- Cache invalidation patterns
- Idempotency key support for mutations
- Distributed locking

### Proposed Architecture

```typescript
// core/modules/cache/cache.module.ts
@Module({
  imports: [RedisModule],
  providers: [
    CacheService,
    IdempotencyService,
    DistributedLockService,
  ],
  exports: [CacheService, IdempotencyService, DistributedLockService],
})
export class CacheModule {}
```

```typescript
// core/modules/cache/cache.service.ts
@Injectable()
export class CacheService {
  constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const data = await this.redis.get(this.prefixKey(key));
    return data ? JSON.parse(data) : null;
  }

  async set<T>(
    key: string,
    value: T,
    options?: CacheOptions,
  ): Promise<void> {
    const serialized = JSON.stringify(value);
    
    if (options?.ttl) {
      await this.redis.setex(this.prefixKey(key), options.ttl, serialized);
    } else {
      await this.redis.set(this.prefixKey(key), serialized);
    }
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options?: CacheOptions,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    
    if (cached !== null) {
      // Stale-while-revalidate pattern
      if (options?.staleWhileRevalidate) {
        this.revalidateInBackground(key, factory, options);
      }
      return cached;
    }

    const value = await factory();
    await this.set(key, value, options);
    return value;
  }

  async invalidate(pattern: string): Promise<void> {
    const keys = await this.redis.keys(this.prefixKey(pattern));
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
```

```typescript
// core/modules/cache/idempotency.service.ts
@Injectable()
export class IdempotencyService {
  private readonly IDEMPOTENCY_PREFIX = 'idempotency:';
  private readonly DEFAULT_TTL = 86400; // 24 hours

  async executeIdempotent<T>(
    key: string,
    operation: () => Promise<T>,
    options?: IdempotencyOptions,
  ): Promise<IdempotencyResult<T>> {
    const cacheKey = `${this.IDEMPOTENCY_PREFIX}${key}`;
    
    // Check for existing result
    const existing = await this.redis.get(cacheKey);
    if (existing) {
      const parsed = JSON.parse(existing);
      return {
        result: parsed.result,
        isReplay: true,
        originalTimestamp: parsed.timestamp,
      };
    }

    // Acquire lock to prevent duplicate execution
    const lockKey = `${cacheKey}:lock`;
    const lock = await this.acquireLock(lockKey, options?.lockTimeout ?? 30000);
    
    if (!lock) {
      throw new ConflictException('Operation already in progress');
    }

    try {
      // Double-check after acquiring lock
      const doubleCheck = await this.redis.get(cacheKey);
      if (doubleCheck) {
        const parsed = JSON.parse(doubleCheck);
        return { result: parsed.result, isReplay: true, originalTimestamp: parsed.timestamp };
      }

      // Execute operation
      const result = await operation();
      
      // Store result
      const stored = {
        result,
        timestamp: Date.now(),
        status: 'completed',
      };
      await this.redis.setex(
        cacheKey,
        options?.ttl ?? this.DEFAULT_TTL,
        JSON.stringify(stored),
      );

      return { result, isReplay: false };
    } finally {
      await this.releaseLock(lockKey, lock);
    }
  }
}
```

```typescript
// core/modules/cache/decorators/cacheable.decorator.ts
export function Cacheable(options: CacheableOptions): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const cacheService = this.cacheService as CacheService;
      const key = options.keyGenerator
        ? options.keyGenerator(...args)
        : `${target.constructor.name}:${String(propertyKey)}:${JSON.stringify(args)}`;

      return cacheService.getOrSet(key, () => originalMethod.apply(this, args), {
        ttl: options.ttl,
        staleWhileRevalidate: options.staleWhileRevalidate,
      });
    };

    return descriptor;
  };
}

// Usage
@Cacheable({ ttl: 300, keyGenerator: (id) => `deployment:${id}` })
async getDeployment(id: string): Promise<Deployment> {
  return this.deploymentRepository.findById(id);
}
```

```typescript
// core/modules/cache/decorators/idempotent.decorator.ts
export function Idempotent(options?: IdempotentOptions): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const idempotencyService = this.idempotencyService as IdempotencyService;
      const request = args.find(arg => arg?.headers?.['idempotency-key']);
      
      if (!request?.headers?.['idempotency-key']) {
        return originalMethod.apply(this, args);
      }

      const key = request.headers['idempotency-key'];
      const { result } = await idempotencyService.executeIdempotent(
        key,
        () => originalMethod.apply(this, args),
        options,
      );

      return result;
    };

    return descriptor;
  };
}

// Usage
@Post()
@Idempotent()
async createDeployment(
  @Headers('idempotency-key') idempotencyKey: string,
  @Body() dto: CreateDeploymentDto,
): Promise<Deployment> {
  return this.deploymentService.create(dto);
}
```

---

## 4. Health Check Standardization with @nestjs/terminus

Comprehensive health checks for all system components.

### Goals

- Standardized health endpoints
- Component-level health indicators
- Readiness vs liveness probes
- Custom health indicators for domain services
- Metrics integration

### Proposed Architecture

```typescript
// core/modules/health/health.module.ts
@Module({
  imports: [
    TerminusModule.forRoot({
      errorLogStyle: 'pretty',
      gracefulShutdownTimeoutMs: 10000,
    }),
    HttpModule,
  ],
  controllers: [HealthController],
  providers: [
    DatabaseHealthIndicator,
    RedisHealthIndicator,
    DockerHealthIndicator,
    TraefikHealthIndicator,
    QueueHealthIndicator,
  ],
})
export class HealthModule {}
```

```typescript
// core/modules/health/health.controller.ts
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: DatabaseHealthIndicator,
    private redis: RedisHealthIndicator,
    private docker: DockerHealthIndicator,
    private traefik: TraefikHealthIndicator,
    private queue: QueueHealthIndicator,
  ) {}

  /**
   * Liveness probe - is the application running?
   * Used by Kubernetes/Docker to determine if container should be restarted
   */
  @Get('live')
  @HealthCheck()
  checkLiveness() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 1000 }),
    ]);
  }

  /**
   * Readiness probe - is the application ready to receive traffic?
   * Used by load balancers to determine if instance should receive requests
   */
  @Get('ready')
  @HealthCheck()
  checkReadiness() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 3000 }),
      () => this.redis.pingCheck('redis', { timeout: 1000 }),
      () => this.docker.isHealthy('docker'),
      () => this.traefik.isHealthy('traefik'),
    ]);
  }

  /**
   * Detailed health check for monitoring dashboards
   */
  @Get()
  @HealthCheck()
  checkAll() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 3000 }),
      () => this.db.connectionPoolCheck('database-pool'),
      () => this.redis.pingCheck('redis', { timeout: 1000 }),
      () => this.redis.memoryCheck('redis-memory', { threshold: 0.9 }),
      () => this.docker.isHealthy('docker'),
      () => this.docker.containerCountCheck('docker-containers', { max: 100 }),
      () => this.traefik.isHealthy('traefik'),
      () => this.queue.isHealthy('queue'),
      () => this.queue.pendingJobsCheck('queue-pending', { threshold: 1000 }),
    ]);
  }
}
```

```typescript
// core/modules/health/indicators/docker-health.indicator.ts
@Injectable()
export class DockerHealthIndicator extends HealthIndicator {
  constructor(private readonly dockerService: DockerService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const info = await this.dockerService.info();
      return this.getStatus(key, true, {
        version: info.ServerVersion,
        containers: info.Containers,
        containersRunning: info.ContainersRunning,
      });
    } catch (error) {
      throw new HealthCheckError(
        'Docker health check failed',
        this.getStatus(key, false, { error: error.message }),
      );
    }
  }

  async containerCountCheck(
    key: string,
    options: { max: number },
  ): Promise<HealthIndicatorResult> {
    const containers = await this.dockerService.listContainers();
    const isHealthy = containers.length <= options.max;
    
    return this.getStatus(key, isHealthy, {
      count: containers.length,
      max: options.max,
    });
  }
}
```

```typescript
// core/modules/health/indicators/traefik-health.indicator.ts
@Injectable()
export class TraefikHealthIndicator extends HealthIndicator {
  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const traefikUrl = this.config.get('TRAEFIK_API_URL');
    
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${traefikUrl}/api/overview`).pipe(
          timeout(5000),
        ),
      );
      
      return this.getStatus(key, true, {
        http: response.data.http,
        tcp: response.data.tcp,
        udp: response.data.udp,
      });
    } catch (error) {
      throw new HealthCheckError(
        'Traefik health check failed',
        this.getStatus(key, false, { error: error.message }),
      );
    }
  }
}
```

### Response Format

```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up", "responseTime": 5 },
    "redis": { "status": "up", "responseTime": 2, "memory": "45%" },
    "docker": { "status": "up", "version": "24.0.7", "containers": 12 },
    "traefik": { "status": "up", "routers": 15, "services": 10 }
  },
  "error": {},
  "details": {
    "database": { "status": "up", "responseTime": 5 },
    "redis": { "status": "up", "responseTime": 2, "memory": "45%" },
    "docker": { "status": "up", "version": "24.0.7", "containers": 12 },
    "traefik": { "status": "up", "routers": 15, "services": 10 }
  }
}
```

---

## 5. Secrets Management

Secure secrets management with support for multiple providers.

### Goals

- Multi-provider support (Vault, AWS Secrets Manager, Azure Key Vault, env)
- Automatic secret rotation
- Secret versioning
- Audit logging
- Development vs production modes

### Proposed Architecture

```typescript
// core/modules/secrets/secrets.module.ts
@Module({
  providers: [
    SecretsService,
    {
      provide: SECRETS_PROVIDER,
      useFactory: (config: ConfigService) => {
        const provider = config.get('SECRETS_PROVIDER');
        switch (provider) {
          case 'vault':
            return new VaultSecretsProvider(config);
          case 'aws':
            return new AwsSecretsProvider(config);
          case 'azure':
            return new AzureSecretsProvider(config);
          default:
            return new EnvSecretsProvider(config);
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: [SecretsService],
})
export class SecretsModule {}
```

```typescript
// core/modules/secrets/secrets.service.ts
@Injectable()
export class SecretsService {
  private readonly cache = new Map<string, CachedSecret>();

  constructor(
    @Inject(SECRETS_PROVIDER) private readonly provider: SecretsProvider,
    private readonly auditService: AuditService,
  ) {}

  async getSecret(key: string): Promise<string> {
    // Check cache
    const cached = this.cache.get(key);
    if (cached && !this.isExpired(cached)) {
      return cached.value;
    }

    // Fetch from provider
    const secret = await this.provider.get(key);
    
    // Cache with TTL
    this.cache.set(key, {
      value: secret.value,
      expiresAt: Date.now() + (secret.ttl ?? 300) * 1000,
      version: secret.version,
    });

    // Audit log
    await this.auditService.log('secret.accessed', {
      key,
      version: secret.version,
    });

    return secret.value;
  }

  async rotateSecret(key: string): Promise<void> {
    await this.provider.rotate(key);
    this.cache.delete(key);
    
    await this.auditService.log('secret.rotated', { key });
  }

  @Cron('0 0 * * *') // Daily
  async checkRotation(): Promise<void> {
    const secrets = await this.provider.listSecrets();
    
    for (const secret of secrets) {
      if (this.shouldRotate(secret)) {
        await this.rotateSecret(secret.key);
      }
    }
  }
}
```

```typescript
// core/modules/secrets/providers/vault.provider.ts
@Injectable()
export class VaultSecretsProvider implements SecretsProvider {
  private client: VaultClient;

  constructor(private readonly config: ConfigService) {
    this.client = new VaultClient({
      endpoint: config.get('VAULT_ADDR'),
      token: config.get('VAULT_TOKEN'),
    });
  }

  async get(key: string): Promise<Secret> {
    const response = await this.client.read(`secret/data/${key}`);
    return {
      value: response.data.data.value,
      version: response.data.metadata.version,
      ttl: response.data.metadata.ttl,
    };
  }

  async rotate(key: string): Promise<void> {
    const current = await this.get(key);
    const newValue = await this.generateNewSecret(key);
    
    await this.client.write(`secret/data/${key}`, {
      data: { value: newValue },
    });
  }
}
```

```typescript
// core/modules/secrets/decorators/inject-secret.decorator.ts
export function InjectSecret(key: string): PropertyDecorator {
  return (target, propertyKey) => {
    const secretsService = Reflect.getMetadata('secrets:service', target);
    
    Object.defineProperty(target, propertyKey, {
      get: async () => {
        return secretsService.getSecret(key);
      },
      enumerable: true,
      configurable: true,
    });
  };
}

// Usage
@Injectable()
export class PaymentService {
  @InjectSecret('STRIPE_SECRET_KEY')
  private stripeKey: string;
}
```

---

## 6. Feature Flags

A comprehensive feature flag system for controlled rollouts and A/B testing.

### Goals

- Multiple targeting strategies (percentage, user, group)
- Real-time flag updates
- A/B testing support
- Metrics and analytics
- SDK for client-side flags

### Proposed Architecture

```typescript
// core/modules/features/feature-flag.module.ts
@Module({
  imports: [CacheModule],
  providers: [
    FeatureFlagService,
    FeatureFlagRepository,
    FeatureMetricsService,
  ],
  exports: [FeatureFlagService],
})
export class FeatureFlagModule {}
```

```typescript
// core/modules/features/feature-flag.service.ts
@Injectable()
export class FeatureFlagService {
  constructor(
    private readonly cache: CacheService,
    private readonly repository: FeatureFlagRepository,
    private readonly metrics: FeatureMetricsService,
  ) {}

  async isEnabled(
    flag: string,
    context?: FeatureFlagContext,
  ): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      // Get flag configuration (cached)
      const flags = await this.cache.getOrSet(
        'feature-flags',
        () => this.repository.getAllFlags(),
        { ttl: 60 }, // 1 minute cache
      );
      
      const flagConfig = flags[flag];
      
      if (!flagConfig) {
        return false;
      }
      
      const result = await this.evaluateFlag(flagConfig, context);
      
      // Track metrics
      await this.metrics.track({
        flag,
        result,
        context,
        evaluationTime: Date.now() - startTime,
      });
      
      return result;
    } catch (error) {
      // Fail open or closed based on flag default
      return false;
    }
  }

  private async evaluateFlag(
    config: FeatureFlagConfig,
    context?: FeatureFlagContext,
  ): Promise<boolean> {
    // Check kill switch
    if (config.enabled === false) {
      return false;
    }
    
    // Check if globally enabled
    if (config.enabled === true || config.enabled === 'all') {
      return true;
    }
    
    // Check environment
    if (config.environments && context?.environment) {
      if (!config.environments.includes(context.environment)) {
        return false;
      }
    }
    
    // Check user allowlist
    if (config.allowedUsers?.includes(context?.userId)) {
      return true;
    }
    
    // Check group targeting
    if (config.groups && context?.groups) {
      const hasMatchingGroup = config.groups.some(g => 
        context.groups.includes(g)
      );
      if (hasMatchingGroup) {
        return true;
      }
    }
    
    // Percentage rollout
    if (config.percentage !== undefined && context?.userId) {
      const hash = this.hashUserId(context.userId, flag);
      return hash % 100 < config.percentage;
    }
    
    // Default
    return config.defaultValue ?? false;
  }

  private hashUserId(userId: string, flag: string): number {
    // Consistent hashing for stable rollouts
    const combined = `${userId}:${flag}`;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  async getVariant<T>(
    flag: string,
    context?: FeatureFlagContext,
  ): Promise<T | null> {
    const flags = await this.cache.getOrSet(
      'feature-flags',
      () => this.repository.getAllFlags(),
      { ttl: 60 },
    );
    
    const flagConfig = flags[flag];
    if (!flagConfig?.variants) {
      return null;
    }
    
    // A/B testing variant selection
    if (context?.userId) {
      const hash = this.hashUserId(context.userId, flag);
      let cumulative = 0;
      
      for (const variant of flagConfig.variants) {
        cumulative += variant.weight;
        if (hash % 100 < cumulative) {
          return variant.value as T;
        }
      }
    }
    
    return flagConfig.defaultVariant ?? null;
  }
}
```

```typescript
// core/modules/features/feature-flag.types.ts
export interface FeatureFlagConfig {
  key: string;
  enabled: boolean | 'all' | 'none';
  percentage?: number;
  environments?: string[];
  allowedUsers?: string[];
  groups?: string[];
  defaultValue?: boolean;
  variants?: FeatureVariant[];
  defaultVariant?: any;
  metadata?: {
    description?: string;
    owner?: string;
    expiresAt?: Date;
  };
}

export interface FeatureFlagContext {
  userId?: string;
  groups?: string[];
  environment?: string;
  attributes?: Record<string, any>;
}

export interface FeatureVariant {
  key: string;
  value: any;
  weight: number; // 0-100
}
```

```typescript
// core/modules/features/decorators/feature-flag.decorator.ts
export function FeatureFlag(
  flag: string,
  options?: FeatureFlagDecoratorOptions,
): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const featureService = this.featureFlagService as FeatureFlagService;
      const context = options?.contextExtractor?.(args) ?? {};
      
      const isEnabled = await featureService.isEnabled(flag, context);
      
      if (!isEnabled) {
        if (options?.fallback) {
          return options.fallback.apply(this, args);
        }
        throw new ForbiddenException(`Feature '${flag}' is not enabled`);
      }
      
      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

// Usage
@Injectable()
export class DeploymentService {
  @FeatureFlag('new-deployment-flow', {
    fallback: function(config) {
      return this.legacyDeploy(config);
    },
  })
  async deploy(config: DeploymentConfig): Promise<Deployment> {
    return this.newDeploymentFlow(config);
  }
}
```

### Usage Examples

```typescript
// Basic usage
if (await this.features.isEnabled('new-deployment-flow', { userId })) {
  return this.newDeploymentService.deploy(config);
} else {
  return this.deploymentService.deploy(config);
}

// A/B testing with variants
const variant = await this.features.getVariant<{ algorithm: string }>(
  'deployment-algorithm',
  { userId },
);

switch (variant?.algorithm) {
  case 'v2':
    return this.deployV2(config);
  case 'v3':
    return this.deployV3(config);
  default:
    return this.deployV1(config);
}

// Controller level
@Controller('deployments')
export class DeploymentController {
  @Post()
  @FeatureFlag('deployments-enabled')
  async createDeployment(@Body() dto: CreateDeploymentDto) {
    return this.deploymentService.create(dto);
  }
}
```

### Admin API

```typescript
// core/modules/features/feature-flag.controller.ts
@Controller('admin/features')
@UseGuards(AdminGuard)
export class FeatureFlagController {
  @Get()
  async listFlags(): Promise<FeatureFlagConfig[]> {
    return this.featureRepository.getAllFlags();
  }

  @Post()
  async createFlag(@Body() dto: CreateFeatureFlagDto): Promise<FeatureFlagConfig> {
    return this.featureRepository.create(dto);
  }

  @Patch(':key')
  async updateFlag(
    @Param('key') key: string,
    @Body() dto: UpdateFeatureFlagDto,
  ): Promise<FeatureFlagConfig> {
    const result = await this.featureRepository.update(key, dto);
    await this.cache.invalidate('feature-flags');
    return result;
  }

  @Delete(':key')
  async deleteFlag(@Param('key') key: string): Promise<void> {
    await this.featureRepository.delete(key);
    await this.cache.invalidate('feature-flags');
  }

  @Get(':key/metrics')
  async getMetrics(@Param('key') key: string): Promise<FeatureMetrics> {
    return this.metricsService.getMetrics(key);
  }
}
```

---

## Implementation Priority

| Priority | Feature | Complexity | Dependencies |
|----------|---------|------------|--------------|
| 1 | Health Check Standardization | Low | @nestjs/terminus |
| 2 | Graceful Shutdown Module | Medium | None |
| 3 | Database Transaction Wrapper | Medium | Drizzle ORM |
| 4 | Redis Caching Layer | Medium | Redis, ioredis |
| 5 | Feature Flags | Medium | Redis/Database |
| 6 | Secrets Management | High | Provider SDKs |

---

## Related Documentation

- [Core Concepts](/.docs/core-concepts/)
- [Architecture Overview](/.docs/reference/ARCHITECTURE.md)
- [Development Workflow](/.docs/guides/DEVELOPMENT-WORKFLOW.md)
