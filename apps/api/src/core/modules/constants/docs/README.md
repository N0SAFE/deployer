# Constants Module

> **Status**: ✅ Stable  
> **Type**: Core Infrastructure Module (Global)  
> **Last Updated**: 2025-11-30

## Overview

The Constants module provides type-safe access to application configuration via **dot-notation paths**. It wraps NestJS `ConfigService` with a custom `Flatten<T>` type utility, enabling IDE autocomplete for deeply nested configuration keys.

## Architecture

```
constants/
├── constants.module.ts        # @Global() module definition
├── constants/
│   ├── config.constants.ts    # Configuration type definitions
│   ├── env.constants.ts       # Environment variable mappings
│   └── index.ts               # Re-exports
└── services/
    └── constants.service.ts   # Type-safe config accessor
```

## Key Features

- **Type-safe dot-notation**: `config.get('database.host')` with full autocomplete
- **Nested config support**: Flatten any depth of configuration objects
- **Global availability**: No imports required in other modules
- **Fallback values**: Type-safe default value support

## Module Configuration

### Registration

```typescript
// In app.module.ts
import { ConstantsModule } from '@/core/modules/constants/constants.module';
import { ConfigModule } from '@nestjs/config';
import { config } from '@/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [config],
      isGlobal: true,
    }),
    ConstantsModule,  // Global - no need to import elsewhere
  ],
})
export class AppModule {}
```

## Services

### ConstantsService

Provides type-safe configuration access with dot-notation:

```typescript
@Injectable()
export class ConstantsService<T extends object = AppConfig> {
  constructor(private readonly configService: ConfigService) {}

  get<K extends FlattenKeys<T>>(key: K): FlattenValue<T, K>;
  get<K extends FlattenKeys<T>>(key: K, defaultValue: FlattenValue<T, K>): FlattenValue<T, K>;
}
```

**Type Magic - `Flatten<T>`**:

```typescript
// Given this config type:
type AppConfig = {
  database: {
    host: string;
    port: number;
    credentials: {
      user: string;
      password: string;
    };
  };
  api: {
    port: number;
  };
};

// The Flatten type generates these keys:
type FlattenKeys<AppConfig> = 
  | 'database.host'
  | 'database.port'
  | 'database.credentials.user'
  | 'database.credentials.password'
  | 'api.port';
```

## Usage Examples

### Basic Usage

```typescript
import { Injectable } from '@nestjs/common';
import { ConstantsService } from '@/core/modules/constants/services/constants.service';

@Injectable()
export class DatabaseService {
  constructor(private readonly constants: ConstantsService) {}

  connect() {
    // Full autocomplete for config keys!
    const host = this.constants.get('database.host');
    const port = this.constants.get('database.port');
    const user = this.constants.get('database.credentials.user');
    
    return { host, port, user };
  }
}
```

### With Default Values

```typescript
@Injectable()
export class ServerService {
  constructor(private readonly constants: ConstantsService) {}

  getPort() {
    // Falls back to 3000 if not configured
    return this.constants.get('api.port', 3000);
  }
}
```

### In Controllers

```typescript
@Controller('config')
export class ConfigController {
  constructor(private readonly constants: ConstantsService) {}

  @Get('public')
  getPublicConfig() {
    return {
      apiUrl: this.constants.get('api.publicUrl'),
      version: this.constants.get('app.version'),
    };
  }
}
```

## Configuration Structure

### Expected Config Shape

```typescript
// config/index.ts
export const config = () => ({
  app: {
    name: process.env.APP_NAME || 'deployer',
    version: process.env.APP_VERSION || '1.0.0',
    env: process.env.NODE_ENV || 'development',
  },
  api: {
    port: parseInt(process.env.API_PORT || '3001', 10),
    publicUrl: process.env.API_PUBLIC_URL,
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'deployer',
    credentials: {
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    },
  },
  docker: {
    host: process.env.DOCKER_HOST || '/var/run/docker.sock',
  },
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  },
});

export type AppConfig = ReturnType<typeof config>;
```

## Type System

### FlattenKeys<T>

Extracts all possible dot-notation paths from nested object type:

```typescript
type FlattenKeys<T, Prefix extends string = ''> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends object
          ? FlattenKeys<T[K], `${Prefix}${K}.`>
          : `${Prefix}${K}`
        : never;
    }[keyof T]
  : never;
```

### FlattenValue<T, K>

Resolves the value type for a given dot-notation key:

```typescript
type FlattenValue<T, K extends string> = K extends `${infer Head}.${infer Tail}`
  ? Head extends keyof T
    ? FlattenValue<T[Head], Tail>
    : never
  : K extends keyof T
    ? T[K]
    : never;
```

## Benefits Over Raw ConfigService

| Feature | ConfigService | ConstantsService |
|---------|---------------|------------------|
| Type Safety | ❌ `any` return | ✅ Exact type |
| Autocomplete | ❌ No | ✅ Full path suggestions |
| Refactoring | ❌ String literals | ✅ Type errors on change |
| Nested Access | ⚠️ Manual | ✅ Automatic flattening |

## Testing

```typescript
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ConstantsService } from '@/core/modules/constants/services/constants.service';

describe('ConstantsService', () => {
  let service: ConstantsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [() => ({
            database: {
              host: 'localhost',
              port: 5432,
            },
          })],
        }),
      ],
      providers: [ConstantsService],
    }).compile();

    service = module.get(ConstantsService);
  });

  it('should get nested config', () => {
    expect(service.get('database.host')).toBe('localhost');
    expect(service.get('database.port')).toBe(5432);
  });

  it('should return default value', () => {
    expect(service.get('database.unknown' as any, 'default')).toBe('default');
  });
});
```

## Integration Points

| Module | Relationship |
|--------|-------------|
| `@nestjs/config` | Foundation - Uses ConfigService internally |
| All Modules | Consumer - Provides type-safe config access |

## Related Documentation

- [NestJS Configuration](https://docs.nestjs.com/techniques/configuration)
- [TypeScript Template Literal Types](https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html)
