# Database Module

> **Status**: ✅ Stable  
> **Type**: Core Infrastructure Module (Global)  
> **Last Updated**: 2025-11-30

## Overview

The Database module provides **DrizzleORM** integration for the deployer platform. As a `@Global()` module, it makes the database connection available throughout the application without explicit imports. It supports PostgreSQL with connection pooling and health checks.

## Architecture

```
database/
├── database.module.ts         # @Global() module definition
├── database.module.spec.ts    # Module tests
├── database-connection.ts     # Connection factory
└── services/
    └── database.service.ts    # DrizzleORM service wrapper
```

## Key Features

- **Global Access**: No imports needed in other modules
- **DrizzleORM**: Type-safe SQL with full TypeScript support
- **Connection Pooling**: Efficient database connections
- **Health Checks**: Database connectivity monitoring
- **Transaction Support**: ACID-compliant transactions

## Module Configuration

### Registration

```typescript
// In app.module.ts
import { DatabaseModule } from '@/core/modules/database/database.module';

@Module({
  imports: [
    DatabaseModule,  // Global - automatically available everywhere
  ],
})
export class AppModule {}
```

### Environment Variables

```env
# Database connection
DATABASE_URL=postgresql://user:password@localhost:5432/deployer

# Optional: Connection pool settings
DB_POOL_MIN=2
DB_POOL_MAX=10
```

## Services

### DatabaseService

Provides access to the DrizzleORM instance:

```typescript
@Injectable()
export class DatabaseService {
  private _db: DrizzleDatabase;

  constructor() {
    this._db = createDrizzleConnection();
  }

  get db(): DrizzleDatabase {
    return this._db;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this._db.execute(sql`SELECT 1`);
      return true;
    } catch {
      return false;
    }
  }
}
```

## Usage Examples

### Basic Query

```typescript
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { projects } from '@/config/drizzle/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class ProjectRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async findById(id: string) {
    const db = this.databaseService.db;
    
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    
    return project || null;
  }

  async findAll() {
    return this.databaseService.db
      .select()
      .from(projects);
  }
}
```

### Insert

```typescript
async create(data: NewProject) {
  const db = this.databaseService.db;
  
  const [project] = await db
    .insert(projects)
    .values(data)
    .returning();
  
  return project;
}
```

### Update

```typescript
async update(id: string, data: Partial<Project>) {
  const db = this.databaseService.db;
  
  const [updated] = await db
    .update(projects)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();
  
  return updated;
}
```

### Delete

```typescript
async delete(id: string) {
  const db = this.databaseService.db;
  
  await db
    .delete(projects)
    .where(eq(projects.id, id));
}
```

### Transactions

```typescript
async transferService(serviceId: string, newProjectId: string) {
  const db = this.databaseService.db;
  
  return await db.transaction(async (tx) => {
    // Update service's project
    const [service] = await tx
      .update(services)
      .set({ projectId: newProjectId })
      .where(eq(services.id, serviceId))
      .returning();
    
    // Update related deployments
    await tx
      .update(deployments)
      .set({ projectId: newProjectId })
      .where(eq(deployments.serviceId, serviceId));
    
    return service;
  });
}
```

### Complex Queries with Joins

```typescript
async getProjectWithServices(projectId: string) {
  const db = this.databaseService.db;
  
  return await db
    .select({
      project: projects,
      services: services,
    })
    .from(projects)
    .leftJoin(services, eq(services.projectId, projects.id))
    .where(eq(projects.id, projectId));
}
```

### Raw SQL (when needed)

```typescript
async customQuery() {
  const db = this.databaseService.db;
  
  const result = await db.execute(sql`
    SELECT 
      p.name,
      COUNT(s.id) as service_count
    FROM projects p
    LEFT JOIN services s ON s.project_id = p.id
    GROUP BY p.id
    ORDER BY service_count DESC
    LIMIT 10
  `);
  
  return result.rows;
}
```

## Schema Location

DrizzleORM schema files are located at:

```
apps/api/src/config/drizzle/schema/
├── index.ts           # Re-exports all tables
├── projects.ts        # Projects table
├── services.ts        # Services table
├── deployments.ts     # Deployments table
├── environments.ts    # Environments table
├── domains.ts         # Domain mappings
└── ...
```

## Health Check Integration

```typescript
@Controller('health')
export class HealthController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Get()
  async check() {
    const dbHealthy = await this.databaseService.healthCheck();
    
    return {
      status: dbHealthy ? 'healthy' : 'unhealthy',
      database: dbHealthy ? 'connected' : 'disconnected',
    };
  }
}
```

## Repository Pattern

Recommended pattern for data access:

```typescript
// repositories/project.repository.ts
@Injectable()
export class ProjectRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.db;
  }

  async findById(id: string) { /* ... */ }
  async findAll() { /* ... */ }
  async create(data: NewProject) { /* ... */ }
  async update(id: string, data: Partial<Project>) { /* ... */ }
  async delete(id: string) { /* ... */ }
}
```

## Testing

### Unit Testing with Mock

```typescript
import { Test } from '@nestjs/testing';
import { DatabaseService } from '@/core/modules/database/services/database.service';

describe('ProjectRepository', () => {
  let repository: ProjectRepository;
  let mockDb: jest.Mocked<DrizzleDatabase>;

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([{ id: '1', name: 'Test' }]),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        ProjectRepository,
        {
          provide: DatabaseService,
          useValue: { db: mockDb },
        },
      ],
    }).compile();

    repository = module.get(ProjectRepository);
  });

  it('should find project by id', async () => {
    const project = await repository.findById('1');
    expect(project).toEqual({ id: '1', name: 'Test' });
  });
});
```

### Integration Testing

```typescript
describe('DatabaseService (Integration)', () => {
  let service: DatabaseService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();

    service = module.get(DatabaseService);
  });

  it('should connect to database', async () => {
    const healthy = await service.healthCheck();
    expect(healthy).toBe(true);
  });
});
```

## Migration Management

DrizzleORM migrations are managed via CLI:

```bash
# Generate migration from schema changes
bun run api -- db:generate

# Push schema to database (development)
bun run api -- db:push

# Run migrations (production)
bun run api -- db:migrate

# Open Drizzle Studio
bun run api -- db:studio
```

## Integration Points

| Module | Relationship |
|--------|-------------|
| `@neondatabase/serverless` | Driver - PostgreSQL connection |
| `drizzle-orm` | ORM - Type-safe SQL |
| All Repositories | Consumer - Data access |
| `ConstantsModule` | Provider - Database URL |

## Performance Considerations

- **Connection Pool**: Managed automatically by driver
- **Query Optimization**: Use proper indexes defined in schema
- **Transaction Scope**: Keep transactions short
- **Batch Operations**: Use `insert().values([...])` for bulk inserts

## Related Documentation

- [DrizzleORM Documentation](https://orm.drizzle.team/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Drizzle Migrations](https://orm.drizzle.team/docs/migrations)
